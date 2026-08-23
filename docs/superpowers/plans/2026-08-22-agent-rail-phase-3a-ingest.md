# Hive Agent Rail — Phase 3a: agent ingest (backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any MCP-speaking agent connect to Hive over HTTP, declare the apps it is connected to, post to the feed, and collect replies the user typed back.

**Architecture:** A new `/mcp` endpoint on the existing axum server speaks JSON-RPC, authenticated by a bearer token. All protocol handling lives in a pure `dispatch` function over `serde_json::Value`, so it is testable without HTTP or a live agent; the axum handler is a thin shell that authenticates and calls it. Agent state sits in an `AgentRegistry` beside `SessionRegistry`, following the same `Arc<RwLock<HashMap>>` pattern. Agent posts are a distinct model rather than overloading `Message`, because a post belongs to an agent and an app, not to a Claude Code session.

**Tech Stack:** Rust 2021, axum 0.8, tokio, serde_json, chrono, uuid, dirs.

**Spec:** `docs/superpowers/specs/2026-08-22-hive-agent-rail-design.md`

**Depends on:** Phases 1–2 (PR #11).

## Global Constraints

- **Do not change the six existing `hub_*` tools, `mcp/handler.rs`'s stdio behaviour, or any `/api/sessions/*` route.** This is a second, parallel surface.
- **The existing stdio MCP server stays as-is.** It serves Claude Code, which spawns `claude-hive mcp`. An external agent cannot use stdio, which is why `/mcp` exists.
- **Every new store follows the existing pattern:** `#[derive(Clone)]`, `Arc<RwLock<...>>` inside, `pub async fn` accessors. See `state/message_store.rs`.
- **Models are `#[serde(rename_all = "camelCase")]`** so the frontend gets camelCase, matching `models/message.rs`.
- **`agent_apps_sync` replaces, never merges.** A disconnected app must disappear from the bar.
- **Server port comes from `CLAUDE_HIVE_PORT`, default 9400.** The `4317` in the mockups was illustrative; the real endpoint is `http://127.0.0.1:9400/mcp`.
- **Protocol version `2024-11-05`**, matching `mcp/handler.rs:186`.
- **Platform constraints from phase 2 apply** — see "Platform constraints learned while building phases 1–2" in the spec. Nothing here creates a window, so none should bite.
- **Test commands:** `cd src-tauri && cargo test <name>`. Full suite: `cargo test`.
- **Windows/PowerShell:** chain with `;`, never `&&`.
- **Commit style:** no `Co-Authored-By` line.

## Scope

**In:** agent identity, per-agent tokens with persistence, app declaration, feed posts, the reply queue, and the `/mcp` transport.

**Out, deliberately:**
- **`agent_ask`** — blocking question-and-wait for agents. `QuestionStore` is keyed by session id and the pending-question UI assumes a session; generalising both is its own piece of work. Not needed for the feed to be useful.
- **`tasks_*` and persistence of posts** — phase 4.
- **All frontend work** — the apps bar, merged feed, per-app filtering, composer and Agents pane are phase 3b. This plan ends with a backend verifiable by `curl`.

---

### Task 1: Agent, app and post models

**Files:**
- Create: `src-tauri/src/models/agent.rs`
- Modify: `src-tauri/src/models/mod.rs`
- Modify: `src-tauri/src/models/events.rs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Agent { id: String, name: String, version: Option<String>, connected_at: DateTime<Utc>, last_seen: DateTime<Utc>, enabled: bool }`
  - `AgentApp { id: String, label: String, health: AppHealth }`, `enum AppHealth { Ok, Degraded, Down }`
  - `AgentPost { id: String, agent_id: String, agent_name: String, app_id: Option<String>, content: String, post_type: MessageType, timestamp: DateTime<Utc>, read: bool }`
  - `AgentReply { id: String, agent_id: String, content: String, created_at: DateTime<Utc> }`
  - `WsEvent` gains `AgentConnected { agent }`, `AgentAppsChanged { agent_id, apps }`, `AgentPosted { post }`

- [ ] **Step 1: Write the failing test**

Create the test module at the bottom of `src-tauri/src/models/agent.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_health_serialises_snake_case_for_the_frontend() {
        let json = serde_json::to_string(&AppHealth::Degraded).unwrap();
        assert_eq!(json, "\"degraded\"");
    }

    #[test]
    fn a_post_serialises_camel_case() {
        let post = AgentPost {
            id: "p1".into(),
            agent_id: "a1".into(),
            agent_name: "Grok".into(),
            app_id: Some("gmail".into()),
            content: "Found 2 tasks".into(),
            post_type: crate::models::MessageType::Info,
            timestamp: chrono::Utc::now(),
            read: false,
        };
        let json = serde_json::to_value(&post).unwrap();
        assert!(json.get("agentId").is_some(), "expected camelCase agentId");
        assert!(json.get("appId").is_some(), "expected camelCase appId");
        assert!(json.get("agent_id").is_none(), "must not emit snake_case");
    }

    #[test]
    fn an_app_with_no_health_reported_defaults_to_ok() {
        let app: AgentApp = serde_json::from_str(r#"{"id":"gmail","label":"Gmail"}"#).unwrap();
        assert_eq!(app.health, AppHealth::Ok);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Add `pub mod agent;` and `pub use agent::*;` to `src-tauri/src/models/mod.rs`, then:

Run: `cd src-tauri; cargo test models::agent`
Expected: FAIL — `AppHealth`, `AgentApp`, `AgentPost` not found.

- [ ] **Step 3: Write the models**

Prepend to `src-tauri/src/models/agent.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::MessageType;

/// An external MCP-speaking agent. Not a Claude Code session: it has no
/// working directory, no terminal to jump to, and no status the user drives.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    /// Taken from the MCP `clientInfo.name` on initialize, so nothing is
    /// hardcoded to a particular vendor. Renameable later, like sessions.
    pub name: String,
    pub version: Option<String>,
    pub connected_at: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    /// False mutes the agent without revoking its token.
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AppHealth {
    #[default]
    Ok,
    Degraded,
    Down,
}

/// One connected app (Gmail, Linear, …) as declared by an agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApp {
    /// Stable slug the agent chooses. Also the icon lookup key.
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub health: AppHealth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPost {
    pub id: String,
    pub agent_id: String,
    /// Denormalised so the feed can render a post whose agent has since
    /// disconnected, rather than showing an orphan row.
    pub agent_name: String,
    pub app_id: Option<String>,
    pub content: String,
    pub post_type: MessageType,
    pub timestamp: DateTime<Utc>,
    pub read: bool,
}

/// A reply the user typed, waiting for the agent to collect it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReply {
    pub id: String,
    pub agent_id: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
}
```

- [ ] **Step 4: Add the websocket events**

In `src-tauri/src/models/events.rs`, extend the `use` line and the enum:

```rust
use super::{Agent, AgentApp, AgentPost, Message, NotifyPriority, Question, Session, SessionStatus};
```

```rust
    #[serde(rename_all = "camelCase")]
    AgentConnected { agent: Agent },
    #[serde(rename_all = "camelCase")]
    AgentAppsChanged { agent_id: String, apps: Vec<AgentApp> },
    #[serde(rename_all = "camelCase")]
    AgentPosted { post: AgentPost },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri; cargo test models::agent`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/models/agent.rs src-tauri/src/models/mod.rs src-tauri/src/models/events.rs
git commit -m "feat: agent, app and post models"
```

---

### Task 2: The agent registry

**Files:**
- Create: `src-tauri/src/state/agent_registry.rs`
- Modify: `src-tauri/src/state/mod.rs`

**Interfaces:**
- Consumes: `Agent`, `AgentApp` from Task 1.
- Produces `AgentRegistry` with:
  - `new() -> Self`
  - `async fn upsert(&self, id: &str, name: String, version: Option<String>) -> Agent`
  - `async fn touch(&self, id: &str)`
  - `async fn get(&self, id: &str) -> Option<Agent>`
  - `async fn list(&self) -> Vec<Agent>`
  - `async fn set_enabled(&self, id: &str, enabled: bool) -> bool`
  - `async fn sync_apps(&self, id: &str, apps: Vec<AgentApp>)`
  - `async fn apps(&self, id: &str) -> Vec<AgentApp>`
  - `async fn all_apps(&self) -> Vec<(String, AgentApp)>` — `(agent_id, app)` pairs for the apps bar

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/state/agent_registry.rs` with the test module only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn app(id: &str, label: &str) -> AgentApp {
        AgentApp { id: id.into(), label: label.into(), health: AppHealth::Ok }
    }

    #[tokio::test]
    async fn upsert_creates_then_updates_without_losing_connected_at() {
        let reg = AgentRegistry::new();
        let first = reg.upsert("a1", "Grok".into(), Some("1.0".into())).await;
        let again = reg.upsert("a1", "Grok Bot".into(), Some("1.1".into())).await;

        assert_eq!(again.connected_at, first.connected_at, "first-seen time must survive");
        assert_eq!(again.name, "Grok Bot", "a renamed client updates the display name");
        assert_eq!(reg.list().await.len(), 1, "upsert must not duplicate");
    }

    #[tokio::test]
    async fn a_new_agent_is_enabled() {
        let reg = AgentRegistry::new();
        let agent = reg.upsert("a1", "Grok".into(), None).await;
        assert!(agent.enabled);
    }

    #[tokio::test]
    async fn disabling_an_agent_keeps_it_listed() {
        let reg = AgentRegistry::new();
        reg.upsert("a1", "Grok".into(), None).await;
        assert!(reg.set_enabled("a1", false).await);
        assert_eq!(reg.get("a1").await.unwrap().enabled, false);
        assert_eq!(reg.list().await.len(), 1, "muting is not removal");
    }

    #[tokio::test]
    async fn set_enabled_on_an_unknown_agent_reports_false() {
        let reg = AgentRegistry::new();
        assert!(!reg.set_enabled("nope", false).await);
    }

    #[tokio::test]
    async fn sync_apps_replaces_rather_than_merges() {
        let reg = AgentRegistry::new();
        reg.upsert("a1", "Grok".into(), None).await;

        reg.sync_apps("a1", vec![app("gmail", "Gmail"), app("linear", "Linear")]).await;
        assert_eq!(reg.apps("a1").await.len(), 2);

        // Linear disconnected on the agent's side; it must leave the bar.
        reg.sync_apps("a1", vec![app("gmail", "Gmail")]).await;
        let apps = reg.apps("a1").await;
        assert_eq!(apps.len(), 1, "sync replaces, so a dropped app disappears");
        assert_eq!(apps[0].id, "gmail");
    }

    #[tokio::test]
    async fn all_apps_reports_which_agent_owns_each() {
        let reg = AgentRegistry::new();
        reg.upsert("a1", "Grok".into(), None).await;
        reg.upsert("a2", "Ops".into(), None).await;
        reg.sync_apps("a1", vec![app("x", "X")]).await;
        reg.sync_apps("a2", vec![app("gmail", "Gmail")]).await;

        let mut all = reg.all_apps().await;
        all.sort_by(|a, b| a.1.id.cmp(&b.1.id));
        assert_eq!(all.len(), 2);
        assert_eq!(all[0], ("a2".to_string(), app("gmail", "Gmail")).into_pair());
        assert_eq!(all[1].0, "a1");
    }

    #[tokio::test]
    async fn touch_advances_last_seen_only() {
        let reg = AgentRegistry::new();
        let created = reg.upsert("a1", "Grok".into(), None).await;
        reg.touch("a1").await;
        let after = reg.get("a1").await.unwrap();
        assert!(after.last_seen >= created.last_seen);
        assert_eq!(after.connected_at, created.connected_at);
    }
}
```

Note: the `all_apps` assertion above uses a helper that does not exist. Replace that one line with a direct comparison:

```rust
        assert_eq!(all[0].0, "a2");
        assert_eq!(all[0].1.id, "gmail");
```

- [ ] **Step 2: Run test to verify it fails**

Add to `src-tauri/src/state/mod.rs`:

```rust
pub mod agent_registry;
pub use agent_registry::AgentRegistry;
```

Run: `cd src-tauri; cargo test state::agent_registry`
Expected: FAIL — `AgentRegistry` not found.

- [ ] **Step 3: Write the registry**

Prepend to `src-tauri/src/state/agent_registry.rs`:

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;

use crate::models::{Agent, AgentApp, AppHealth};

/// Agents and the apps they have declared. Mirrors `SessionRegistry`'s shape so
/// the two read the same way; kept separate because an agent has no working
/// directory, terminal handle, or user-driven status.
#[derive(Debug, Clone)]
pub struct AgentRegistry {
    agents: Arc<RwLock<HashMap<String, Agent>>>,
    apps: Arc<RwLock<HashMap<String, Vec<AgentApp>>>>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self {
            agents: Arc::new(RwLock::new(HashMap::new())),
            apps: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create the agent, or update the name and version a returning client
    /// reports. `connected_at` is set once and never moved, so the pane can
    /// show how long an agent has been around.
    pub async fn upsert(&self, id: &str, name: String, version: Option<String>) -> Agent {
        let now = Utc::now();
        let mut agents = self.agents.write().await;
        let agent = agents
            .entry(id.to_string())
            .and_modify(|a| {
                a.name = name.clone();
                a.version = version.clone();
                a.last_seen = now;
            })
            .or_insert_with(|| Agent {
                id: id.to_string(),
                name,
                version,
                connected_at: now,
                last_seen: now,
                enabled: true,
            });
        agent.clone()
    }

    pub async fn touch(&self, id: &str) {
        if let Some(agent) = self.agents.write().await.get_mut(id) {
            agent.last_seen = Utc::now();
        }
    }

    pub async fn get(&self, id: &str) -> Option<Agent> {
        self.agents.read().await.get(id).cloned()
    }

    pub async fn list(&self) -> Vec<Agent> {
        self.agents.read().await.values().cloned().collect()
    }

    /// Mute without revoking: the agent stays listed and keeps its token.
    pub async fn set_enabled(&self, id: &str, enabled: bool) -> bool {
        match self.agents.write().await.get_mut(id) {
            Some(agent) => {
                agent.enabled = enabled;
                true
            }
            None => false,
        }
    }

    /// Replace the agent's app list wholesale. Replacing rather than merging is
    /// the whole point: an app the agent no longer reports has disconnected and
    /// must leave the bar, and a merge could never express that.
    pub async fn sync_apps(&self, id: &str, apps: Vec<AgentApp>) {
        self.apps.write().await.insert(id.to_string(), apps);
    }

    pub async fn apps(&self, id: &str) -> Vec<AgentApp> {
        self.apps.read().await.get(id).cloned().unwrap_or_default()
    }

    /// Every app across every agent, tagged with its owner so the bar can show
    /// two agents that both expose Gmail without collapsing them.
    pub async fn all_apps(&self) -> Vec<(String, AgentApp)> {
        self.apps
            .read()
            .await
            .iter()
            .flat_map(|(agent_id, apps)| {
                apps.iter().map(move |app| (agent_id.clone(), app.clone()))
            })
            .collect()
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}
```

Add `#[allow(unused_imports)]` nowhere — if `AppHealth` is unused outside tests, import it inside the test module instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri; cargo test state::agent_registry`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state/agent_registry.rs src-tauri/src/state/mod.rs
git commit -m "feat: agent registry with replace-semantics app sync"
```

---

### Task 3: A token that survives a restart

The user pastes this token into their agent's config once. An in-memory token would be invalidated by every Hive restart, which makes the feature unusable — so this is the one piece of persistence phase 3 needs, ahead of phase 4's task store.

**Files:**
- Create: `src-tauri/src/state/agent_tokens.rs`
- Modify: `src-tauri/src/state/mod.rs`

**Interfaces:**
- Consumes: nothing.
- Produces `AgentTokens` with:
  - `fn load_or_create(dir: &Path) -> Self` — reads `agent-tokens.json` from `dir`, creating a default token if absent
  - `fn config_dir() -> Option<PathBuf>` — `dirs::config_dir()/claude-hive`
  - `fn agent_id_for(&self, token: &str) -> Option<String>`
  - `fn issue(&mut self, label: &str) -> String` — returns the new token
  - `fn tokens(&self) -> Vec<(String, String)>` — `(token, agent_id)` pairs
  - `fn save(&self, dir: &Path) -> std::io::Result<()>`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/state/agent_tokens.rs` with the test module only:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_a_default_token_on_first_run() {
        let dir = tempfile::tempdir().unwrap();
        let tokens = AgentTokens::load_or_create(dir.path());
        assert_eq!(tokens.tokens().len(), 1, "first run issues one token");
        let (token, agent_id) = tokens.tokens().pop().unwrap();
        assert!(token.starts_with("hive_ag_"), "got {token}");
        assert!(!agent_id.is_empty());
    }

    #[test]
    fn the_token_is_the_same_after_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let first = AgentTokens::load_or_create(dir.path());
        let first_token = first.tokens()[0].0.clone();
        first.save(dir.path()).unwrap();

        // A restart must not invalidate a token the user has already pasted
        // into their agent's config.
        let second = AgentTokens::load_or_create(dir.path());
        assert_eq!(second.tokens()[0].0, first_token);
    }

    #[test]
    fn resolves_an_agent_id_from_a_token_and_rejects_anything_else() {
        let dir = tempfile::tempdir().unwrap();
        let tokens = AgentTokens::load_or_create(dir.path());
        let (token, agent_id) = tokens.tokens().pop().unwrap();

        assert_eq!(tokens.agent_id_for(&token), Some(agent_id));
        assert_eq!(tokens.agent_id_for("hive_ag_wrong"), None);
        assert_eq!(tokens.agent_id_for(""), None);
    }

    #[test]
    fn issue_adds_a_distinct_token_and_agent() {
        let dir = tempfile::tempdir().unwrap();
        let mut tokens = AgentTokens::load_or_create(dir.path());
        let extra = tokens.issue("research");

        assert_eq!(tokens.tokens().len(), 2);
        assert!(tokens.agent_id_for(&extra).is_some());
        let ids: Vec<String> = tokens.tokens().into_iter().map(|(_, id)| id).collect();
        assert_ne!(ids[0], ids[1], "each token maps to its own agent");
    }

    #[test]
    fn a_corrupt_file_is_replaced_rather_than_fatal() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("agent-tokens.json"), "{not json").unwrap();
        let tokens = AgentTokens::load_or_create(dir.path());
        assert_eq!(tokens.tokens().len(), 1, "unreadable settings must not stop startup");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Add to `src-tauri/src/state/mod.rs`:

```rust
pub mod agent_tokens;
pub use agent_tokens::AgentTokens;
```

Run: `cd src-tauri; cargo test state::agent_tokens`
Expected: FAIL — `AgentTokens` not found.

- [ ] **Step 3: Write the token store**

Prepend to `src-tauri/src/state/agent_tokens.rs`:

```rust
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const FILE_NAME: &str = "agent-tokens.json";

/// Bearer tokens, one per agent, persisted to disk.
///
/// Persisted because the user pastes a token into their agent's configuration
/// once. Regenerating it on every restart would silently break every agent
/// they had set up.
///
/// One token per agent rather than one shared secret: a shared secret cannot be
/// revoked for a single agent without breaking the rest, and the feed cannot
/// attribute a post it did not already trust.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentTokens {
    /// token → agent id
    #[serde(default)]
    tokens: HashMap<String, String>,
    /// agent id → the label shown while the agent has never connected
    #[serde(default)]
    labels: HashMap<String, String>,
}

impl AgentTokens {
    /// `%APPDATA%/claude-hive` on Windows, the XDG config dir elsewhere.
    pub fn config_dir() -> Option<PathBuf> {
        dirs::config_dir().map(|d| d.join("claude-hive"))
    }

    pub fn load_or_create(dir: &Path) -> Self {
        let path = dir.join(FILE_NAME);
        let parsed = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Self>(&raw).ok());

        match parsed {
            Some(loaded) if !loaded.tokens.is_empty() => loaded,
            // Missing, unreadable, corrupt, or empty: start fresh rather than
            // refuse to boot. The cost is a token the user must re-copy, which
            // beats a dashboard that will not start.
            _ => {
                let mut fresh = Self::default();
                fresh.issue("default");
                let _ = fresh.save(dir);
                fresh
            }
        }
    }

    pub fn issue(&mut self, label: &str) -> String {
        let token = format!("hive_ag_{}", Uuid::new_v4().simple());
        let agent_id = Uuid::new_v4().to_string();
        self.labels.insert(agent_id.clone(), label.to_string());
        self.tokens.insert(token.clone(), agent_id);
        token
    }

    pub fn agent_id_for(&self, token: &str) -> Option<String> {
        if token.is_empty() {
            return None;
        }
        self.tokens.get(token).cloned()
    }

    pub fn label_for(&self, agent_id: &str) -> Option<String> {
        self.labels.get(agent_id).cloned()
    }

    pub fn tokens(&self) -> Vec<(String, String)> {
        self.tokens
            .iter()
            .map(|(t, a)| (t.clone(), a.clone()))
            .collect()
    }

    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(dir.join(FILE_NAME), json)
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

`tempfile` is already a dev-dependency (`src-tauri/Cargo.toml`).

Run: `cd src-tauri; cargo test state::agent_tokens`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state/agent_tokens.rs src-tauri/src/state/mod.rs
git commit -m "feat: persistent per-agent bearer tokens"
```

---

### Task 4: The agent post store and reply queue

**Files:**
- Create: `src-tauri/src/state/agent_feed.rs`
- Modify: `src-tauri/src/state/mod.rs`

**Interfaces:**
- Consumes: `AgentPost`, `AgentReply`, `MessageType` from Task 1.
- Produces `AgentFeed` with:
  - `new() -> Self`
  - `async fn post(&self, agent_id: &str, agent_name: &str, app_id: Option<String>, content: String, post_type: MessageType) -> AgentPost`
  - `async fn recent(&self, limit: usize) -> Vec<AgentPost>` — newest first, across all agents
  - `async fn for_app(&self, app_id: &str, limit: usize) -> Vec<AgentPost>`
  - `async fn enqueue_reply(&self, agent_id: &str, content: String) -> AgentReply`
  - `async fn drain_replies(&self, agent_id: &str) -> Vec<AgentReply>`
  - `async fn pending_reply_count(&self, agent_id: &str) -> usize`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/state/agent_feed.rs` with the test module only:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::MessageType;

    #[tokio::test]
    async fn recent_returns_newest_first() {
        let feed = AgentFeed::new();
        feed.post("a1", "Grok", None, "first".into(), MessageType::Info).await;
        feed.post("a1", "Grok", None, "second".into(), MessageType::Info).await;

        let recent = feed.recent(10).await;
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].content, "second", "newest first");
    }

    #[tokio::test]
    async fn recent_respects_the_limit() {
        let feed = AgentFeed::new();
        for i in 0..5 {
            feed.post("a1", "Grok", None, format!("p{i}"), MessageType::Info).await;
        }
        assert_eq!(feed.recent(3).await.len(), 3);
    }

    #[tokio::test]
    async fn for_app_filters_to_one_app() {
        let feed = AgentFeed::new();
        feed.post("a1", "Grok", Some("gmail".into()), "mail".into(), MessageType::Info).await;
        feed.post("a1", "Grok", Some("linear".into()), "issue".into(), MessageType::Info).await;
        feed.post("a1", "Grok", None, "no app".into(), MessageType::Info).await;

        let gmail = feed.for_app("gmail", 10).await;
        assert_eq!(gmail.len(), 1);
        assert_eq!(gmail[0].content, "mail");
    }

    #[tokio::test]
    async fn a_post_carries_the_agent_name_so_the_row_survives_a_disconnect() {
        let feed = AgentFeed::new();
        let post = feed.post("a1", "Grok", None, "hi".into(), MessageType::Info).await;
        assert_eq!(post.agent_name, "Grok");
        assert_eq!(post.agent_id, "a1");
        assert!(!post.read);
    }

    #[tokio::test]
    async fn replies_queue_until_drained_then_are_gone() {
        let feed = AgentFeed::new();
        feed.enqueue_reply("a1", "look into the tauri change".into()).await;
        feed.enqueue_reply("a1", "and the invoicing thread".into()).await;
        assert_eq!(feed.pending_reply_count("a1").await, 2);

        let drained = feed.drain_replies("a1").await;
        assert_eq!(drained.len(), 2);
        assert_eq!(drained[0].content, "look into the tauri change", "oldest first");

        // Draining is destructive: an agent that polls twice must not see the
        // same reply again.
        assert_eq!(feed.drain_replies("a1").await.len(), 0);
        assert_eq!(feed.pending_reply_count("a1").await, 0);
    }

    #[tokio::test]
    async fn replies_are_kept_per_agent() {
        let feed = AgentFeed::new();
        feed.enqueue_reply("a1", "for grok".into()).await;
        feed.enqueue_reply("a2", "for ops".into()).await;

        assert_eq!(feed.drain_replies("a1").await.len(), 1);
        assert_eq!(feed.pending_reply_count("a2").await, 1, "draining one agent must not touch another");
    }

    #[tokio::test]
    async fn draining_an_unknown_agent_is_empty_not_a_panic() {
        let feed = AgentFeed::new();
        assert_eq!(feed.drain_replies("nobody").await.len(), 0);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Add to `src-tauri/src/state/mod.rs`:

```rust
pub mod agent_feed;
pub use agent_feed::AgentFeed;
```

Run: `cd src-tauri; cargo test state::agent_feed`
Expected: FAIL — `AgentFeed` not found.

- [ ] **Step 3: Write the store**

Prepend to `src-tauri/src/state/agent_feed.rs`:

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;
use uuid::Uuid;

use crate::models::{AgentPost, AgentReply, MessageType};

/// How many posts to keep in memory. Posts are not persisted in this phase, so
/// this only bounds growth over a long-running session.
const MAX_POSTS: usize = 1000;

/// Agent posts and the replies waiting to go back to each agent.
#[derive(Debug, Clone)]
pub struct AgentFeed {
    /// Oldest first, so pushing is cheap; readers reverse.
    posts: Arc<RwLock<Vec<AgentPost>>>,
    /// agent id → replies the user typed, oldest first.
    replies: Arc<RwLock<HashMap<String, Vec<AgentReply>>>>,
}

impl AgentFeed {
    pub fn new() -> Self {
        Self {
            posts: Arc::new(RwLock::new(Vec::new())),
            replies: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn post(
        &self,
        agent_id: &str,
        agent_name: &str,
        app_id: Option<String>,
        content: String,
        post_type: MessageType,
    ) -> AgentPost {
        let post = AgentPost {
            id: Uuid::new_v4().to_string(),
            agent_id: agent_id.to_string(),
            agent_name: agent_name.to_string(),
            app_id,
            content,
            post_type,
            timestamp: Utc::now(),
            read: false,
        };

        let mut posts = self.posts.write().await;
        posts.push(post.clone());
        if posts.len() > MAX_POSTS {
            let excess = posts.len() - MAX_POSTS;
            posts.drain(0..excess);
        }
        post
    }

    pub async fn recent(&self, limit: usize) -> Vec<AgentPost> {
        self.posts
            .read()
            .await
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect()
    }

    pub async fn for_app(&self, app_id: &str, limit: usize) -> Vec<AgentPost> {
        self.posts
            .read()
            .await
            .iter()
            .rev()
            .filter(|p| p.app_id.as_deref() == Some(app_id))
            .take(limit)
            .cloned()
            .collect()
    }

    pub async fn enqueue_reply(&self, agent_id: &str, content: String) -> AgentReply {
        let reply = AgentReply {
            id: Uuid::new_v4().to_string(),
            agent_id: agent_id.to_string(),
            content,
            created_at: Utc::now(),
        };
        self.replies
            .write()
            .await
            .entry(agent_id.to_string())
            .or_default()
            .push(reply.clone());
        reply
    }

    /// Hand over every queued reply and forget them.
    ///
    /// Destructive on purpose: MCP is request/response, so this is the only way
    /// a reply reaches an agent, and an agent that polls twice must not act on
    /// the same instruction twice.
    pub async fn drain_replies(&self, agent_id: &str) -> Vec<AgentReply> {
        self.replies
            .write()
            .await
            .remove(agent_id)
            .unwrap_or_default()
    }

    pub async fn pending_reply_count(&self, agent_id: &str) -> usize {
        self.replies
            .read()
            .await
            .get(agent_id)
            .map(|r| r.len())
            .unwrap_or(0)
    }
}

impl Default for AgentFeed {
    fn default() -> Self {
        Self::new()
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri; cargo test state::agent_feed`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state/agent_feed.rs src-tauri/src/state/mod.rs
git commit -m "feat: agent post store and reply queue"
```

---

### Task 5: Wire the new state into AppState

**Files:**
- Modify: `src-tauri/src/server/app_state.rs`

**Interfaces:**
- Consumes: `AgentRegistry` (Task 2), `AgentTokens` (Task 3), `AgentFeed` (Task 4).
- Produces: `AppState` gains `pub agents: AgentRegistry`, `pub agent_feed: AgentFeed`, `pub agent_tokens: Arc<RwLock<AgentTokens>>`, plus:
  - `AppState::new()` — production, loads tokens from `AgentTokens::config_dir()`
  - `AppState::with_token_dir(dir: &Path) -> Self` — **every test must use this.** `new()` reads and writes the user's real `%APPDATA%/claude-hive`, so a test calling it would touch their actual token file and could hand a later test a token issued by an earlier one.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/server/app_state.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_fresh_state_has_an_agent_token_and_no_agents() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::with_token_dir(dir.path());
        assert!(
            !state.agent_tokens.read().await.tokens().is_empty(),
            "a token must exist so the Agents pane has something to hand out"
        );
        assert!(state.agents.list().await.is_empty());
        assert!(state.agent_feed.recent(10).await.is_empty());
    }

    #[tokio::test]
    async fn two_test_states_do_not_share_a_token() {
        // Guards against a test accidentally using new() and picking up the
        // developer's real token file.
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let first = AppState::with_token_dir(a.path());
        let second = AppState::with_token_dir(b.path());

        let ta = first.agent_tokens.read().await.tokens()[0].0.clone();
        let tb = second.agent_tokens.read().await.tokens()[0].0.clone();
        assert_ne!(ta, tb);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri; cargo test server::app_state`
Expected: FAIL — no field `agent_tokens` on `AppState`.

- [ ] **Step 3: Extend AppState**

Rewrite `src-tauri/src/server/app_state.rs`:

```rust
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use crate::models::WsEvent;
use crate::state::{
    AgentFeed, AgentRegistry, AgentTokens, MessageStore, PlanUsageClient, QuestionStore,
    SessionRegistry, UsageScanner,
};

#[derive(Clone)]
pub struct AppState {
    pub sessions: SessionRegistry,
    pub messages: MessageStore,
    pub questions: QuestionStore,
    pub usage: UsageScanner,
    pub plan_usage: PlanUsageClient,
    pub agents: AgentRegistry,
    pub agent_feed: AgentFeed,
    /// Behind a lock because issuing a token mutates and then persists it.
    pub agent_tokens: Arc<RwLock<AgentTokens>>,
    pub event_tx: broadcast::Sender<WsEvent>,
}

impl AppState {
    pub fn new() -> Self {
        // Fall back to a temp dir when there is no config dir, so an odd
        // environment still gets a working token rather than none.
        let dir = AgentTokens::config_dir().unwrap_or_else(std::env::temp_dir);
        Self::with_token_dir(&dir)
    }

    /// Load tokens from a specific directory.
    ///
    /// Tests must use this rather than `new()`: `new()` reads and writes the
    /// real user config directory, so a test would mutate the developer's own
    /// token file and could inherit a token issued by an unrelated test.
    pub fn with_token_dir(dir: &std::path::Path) -> Self {
        let (event_tx, _) = broadcast::channel(256);
        let tokens = AgentTokens::load_or_create(dir);

        Self {
            sessions: SessionRegistry::new(),
            messages: MessageStore::new(),
            questions: QuestionStore::new(),
            usage: UsageScanner::new(),
            plan_usage: PlanUsageClient::new(),
            agents: AgentRegistry::new(),
            agent_feed: AgentFeed::new(),
            agent_tokens: Arc::new(RwLock::new(tokens)),
            event_tx,
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri; cargo test server::app_state`
Expected: PASS, 1 test.

Then confirm nothing else broke: `cargo test`
Expected: all previous tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/server/app_state.rs
git commit -m "feat: hold agent registry, feed and tokens in AppState"
```

---

### Task 6: The MCP dispatch core

The protocol, as a pure async function over JSON. No HTTP, no sockets — so every branch is testable directly. This is the same split that made phase 2's geometry testable.

**Files:**
- Create: `src-tauri/src/mcp/agent_tools.rs`
- Create: `src-tauri/src/mcp/agent_dispatch.rs`
- Modify: `src-tauri/src/mcp/mod.rs`

**Interfaces:**
- Consumes: `AppState` (Task 5), `JsonRpcResponse` from `mcp/types.rs`.
- Produces:
  - `AGENT_TOOLS: &[ToolDef]` — `agent_apps_sync`, `agent_post`, `agent_inbox`
  - `SERVER_INSTRUCTIONS: &str` — injected into the agent's system prompt by clients that honour it
  - `async fn dispatch(state: &AppState, agent_id: &str, method: &str, id: Option<Value>, params: Option<Value>) -> Option<JsonRpcResponse>` — `None` for notifications

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/mcp/agent_dispatch.rs` with the test module only:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::app_state::AppState;
    use serde_json::json;

    /// A state with an isolated token dir. Never AppState::new() in a test —
    /// that reads and writes the real user config directory.
    fn test_state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::with_token_dir(dir.path());
        (state, dir)
    }

    async fn call(state: &AppState, tool: &str, args: Value) -> Value {
        let params = json!({ "name": tool, "arguments": args });
        let response = dispatch(state, "a1", "tools/call", Some(json!(1)), Some(params))
            .await
            .expect("tools/call must respond");
        serde_json::to_value(response).unwrap()
    }

    #[tokio::test]
    async fn initialize_reports_the_protocol_and_carries_instructions() {
        let (state, _dir) = test_state();
        let response = dispatch(&state, "a1", "initialize", Some(json!(1)), None)
            .await
            .unwrap();
        let value = serde_json::to_value(response).unwrap();

        assert_eq!(value["result"]["protocolVersion"], "2024-11-05");
        let instructions = value["result"]["instructions"].as_str().unwrap();
        assert!(
            instructions.contains("agent_post"),
            "instructions must tell the model to post, or it never will"
        );
    }

    #[tokio::test]
    async fn initialize_names_the_agent_from_client_info() {
        let (state, _dir) = test_state();
        let params = json!({ "clientInfo": { "name": "Grok", "version": "2.1" } });
        dispatch(&state, "a1", "initialize", Some(json!(1)), Some(params)).await;

        let agent = state.agents.get("a1").await.expect("agent must be registered");
        assert_eq!(agent.name, "Grok", "the name comes off the wire, not a constant");
        assert_eq!(agent.version.as_deref(), Some("2.1"));
    }

    #[tokio::test]
    async fn initialize_without_client_info_still_registers_something_usable() {
        let (state, _dir) = test_state();
        dispatch(&state, "a1", "initialize", Some(json!(1)), None).await;
        let agent = state.agents.get("a1").await.unwrap();
        assert!(!agent.name.is_empty(), "a nameless row is useless in the pane");
    }

    #[tokio::test]
    async fn notifications_get_no_response() {
        let (state, _dir) = test_state();
        assert!(dispatch(&state, "a1", "notifications/initialized", None, None).await.is_none());
    }

    #[tokio::test]
    async fn tools_list_advertises_the_agent_tools_only() {
        let (state, _dir) = test_state();
        let response = dispatch(&state, "a1", "tools/list", Some(json!(1)), None).await.unwrap();
        let value = serde_json::to_value(response).unwrap();
        let names: Vec<String> = value["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect();

        assert!(names.contains(&"agent_post".to_string()));
        assert!(names.contains(&"agent_apps_sync".to_string()));
        assert!(names.contains(&"agent_inbox".to_string()));
        assert!(
            !names.iter().any(|n| n.starts_with("hub_")),
            "the session tools are not an agent's business: {names:?}"
        );
    }

    #[tokio::test]
    async fn an_unknown_method_is_an_error_not_a_panic() {
        let (state, _dir) = test_state();
        let response = dispatch(&state, "a1", "nope/nope", Some(json!(1)), None).await.unwrap();
        let value = serde_json::to_value(response).unwrap();
        assert_eq!(value["error"]["code"], -32601);
    }

    #[tokio::test]
    async fn agent_post_lands_in_the_feed() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;

        let value = call(&state, "agent_post", json!({
            "content": "Tauri v3 alpha dropped",
            "app_id": "x",
            "type": "info"
        })).await;
        assert!(value["error"].is_null(), "unexpected error: {value}");

        let posts = state.agent_feed.recent(10).await;
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].content, "Tauri v3 alpha dropped");
        assert_eq!(posts[0].app_id.as_deref(), Some("x"));
        assert_eq!(posts[0].agent_name, "Grok");
    }

    #[tokio::test]
    async fn agent_post_requires_content() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let value = call(&state, "agent_post", json!({ "app_id": "x" })).await;
        assert!(
            value["result"]["isError"].as_bool().unwrap_or(false),
            "a post with no content must be refused: {value}"
        );
        assert!(state.agent_feed.recent(10).await.is_empty());
    }

    #[tokio::test]
    async fn a_disabled_agent_cannot_post() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        state.agents.set_enabled("a1", false).await;

        let value = call(&state, "agent_post", json!({ "content": "hello" })).await;
        assert!(
            value["result"]["isError"].as_bool().unwrap_or(false),
            "muting an agent must actually stop it: {value}"
        );
        assert!(state.agent_feed.recent(10).await.is_empty());
    }

    #[tokio::test]
    async fn agent_apps_sync_replaces_the_app_list() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;

        call(&state, "agent_apps_sync", json!({
            "apps": [
                { "id": "gmail", "label": "Gmail" },
                { "id": "linear", "label": "Linear", "health": "degraded" }
            ]
        })).await;
        assert_eq!(state.agents.apps("a1").await.len(), 2);

        call(&state, "agent_apps_sync", json!({ "apps": [{ "id": "gmail", "label": "Gmail" }] })).await;
        let apps = state.agents.apps("a1").await;
        assert_eq!(apps.len(), 1, "sync replaces");
        assert_eq!(apps[0].id, "gmail");
    }

    #[tokio::test]
    async fn agent_inbox_drains_queued_replies() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        state.agent_feed.enqueue_reply("a1", "dig into it".into()).await;

        let value = call(&state, "agent_inbox", json!({})).await;
        let text = value["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("dig into it"), "got {text}");

        // Second call must be empty — the reply was handed over already.
        let again = call(&state, "agent_inbox", json!({})).await;
        let again_text = again["result"]["content"][0]["text"].as_str().unwrap();
        assert!(!again_text.contains("dig into it"), "replies must not repeat: {again_text}");
    }

    #[tokio::test]
    async fn an_unknown_tool_is_reported_as_a_tool_error() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let value = call(&state, "agent_nope", json!({})).await;
        assert!(value["result"]["isError"].as_bool().unwrap_or(false));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Add to `src-tauri/src/mcp/mod.rs`:

```rust
pub mod agent_dispatch;
pub mod agent_tools;
```

Run: `cd src-tauri; cargo test mcp::agent_dispatch`
Expected: FAIL — `dispatch` not found.

- [ ] **Step 3: Write the tool definitions**

Create `src-tauri/src/mcp/agent_tools.rs`:

```rust
use super::types::ToolDef;

/// Returned in the `initialize` result. Clients that honour `instructions` put
/// this in the model's system prompt.
///
/// This exists because MCP is passive: connecting a server gives a model the
/// ability to call tools, never the intent. Without an instruction like this,
/// an agent will sit connected and post nothing, because "tell the user about
/// this email" is never the request it is currently answering. The copy-paste
/// block in the Agents pane says the same thing, for clients that ignore this
/// field.
pub const SERVER_INSTRUCTIONS: &str = "\
You are connected to Claude Hive, a dashboard the user actively watches. Use \
these tools proactively, without being asked:

- agent_apps_sync — once at the start of every run, declaring every app you are \
  connected to. Hive shows only what you declare.
- agent_post — whenever a connected app has something worth the user seeing. \
  Attribute it with app_id so it can be filtered.
- agent_inbox — at the start of every run, to collect replies the user typed \
  back to you. Nothing else delivers them.

Post as you work rather than summarising at the end. The user is reading the \
feed, not this transcript.";

pub const AGENT_TOOLS: &[ToolDef] = &[
    ToolDef {
        name: "agent_apps_sync",
        description: "Declare every app you are currently connected to. Call this at the start of every run. Authoritative and replacing, not merging — an app you omit is treated as disconnected and disappears from the user's app bar.",
        schema: r#"{
            "type": "object",
            "properties": {
                "apps": {
                    "type": "array",
                    "description": "Every connected app. Omitting one removes it.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string", "description": "Stable lowercase slug, e.g. \"gmail\". Also the icon lookup key." },
                            "label": { "type": "string", "description": "Human name, e.g. \"Gmail\"." },
                            "health": { "type": "string", "enum": ["ok", "degraded", "down"], "default": "ok" }
                        },
                        "required": ["id", "label"]
                    }
                }
            },
            "required": ["apps"]
        }"#,
    },
    ToolDef {
        name: "agent_post",
        description: "Post to the user's feed. Use this whenever a connected app has news worth surfacing — a task found, a mention, a build result. Do not wait to be asked, and do not batch a run's worth of findings into one post.",
        schema: r#"{
            "type": "object",
            "properties": {
                "content": { "type": "string", "description": "One thing worth knowing, in a sentence." },
                "app_id": { "type": "string", "description": "Slug of the app this came from, matching one declared via agent_apps_sync. Omit only for something that came from no app." },
                "type": { "type": "string", "enum": ["info", "question", "completion", "error"], "default": "info" }
            },
            "required": ["content"]
        }"#,
    },
    ToolDef {
        name: "agent_inbox",
        description: "Collect replies the user typed back to you in Hive, and clear them. Call at the start of every run. This is the only way their replies reach you — Hive cannot push to you, so an uncollected reply waits indefinitely. Each reply is delivered once.",
        schema: r#"{
            "type": "object",
            "properties": {}
        }"#,
    },
];
```

- [ ] **Step 4: Write the dispatch**

Prepend to `src-tauri/src/mcp/agent_dispatch.rs`:

```rust
use serde_json::{json, Value};

use crate::mcp::agent_tools::{AGENT_TOOLS, SERVER_INSTRUCTIONS};
use crate::mcp::types::JsonRpcResponse;
use crate::models::{AgentApp, MessageType, WsEvent};
use crate::server::app_state::AppState;

/// Wrap text as an MCP tool result.
fn text_result(id: Option<Value>, text: impl Into<String>) -> JsonRpcResponse {
    JsonRpcResponse::success(
        id,
        json!({ "content": [{ "type": "text", "text": text.into() }] }),
    )
}

/// A failure the model should see and can act on, as opposed to a protocol
/// error. MCP expects tool failures in the result with `isError`, not as a
/// JSON-RPC error, so the model gets to read what went wrong.
fn tool_error(id: Option<Value>, text: impl Into<String>) -> JsonRpcResponse {
    JsonRpcResponse::success(
        id,
        json!({
            "content": [{ "type": "text", "text": text.into() }],
            "isError": true
        }),
    )
}

/// Handle one JSON-RPC request from an authenticated agent.
///
/// Pure in the sense that matters: no sockets, no HTTP, no globals. The caller
/// has already resolved `agent_id` from the bearer token, so every branch here
/// is directly testable.
///
/// Returns `None` for notifications, which per JSON-RPC take no response.
pub async fn dispatch(
    state: &AppState,
    agent_id: &str,
    method: &str,
    id: Option<Value>,
    params: Option<Value>,
) -> Option<JsonRpcResponse> {
    match method {
        "initialize" => Some(handle_initialize(state, agent_id, id, params).await),
        "tools/list" => Some(handle_tools_list(id)),
        "tools/call" => Some(handle_tools_call(state, agent_id, id, params).await),
        // Notifications are fire-and-forget.
        m if m.starts_with("notifications/") || m == "initialized" => None,
        other => Some(JsonRpcResponse::error(
            id,
            -32601,
            format!("Method not found: {other}"),
        )),
    }
}

async fn handle_initialize(
    state: &AppState,
    agent_id: &str,
    id: Option<Value>,
    params: Option<Value>,
) -> JsonRpcResponse {
    // The display name comes off the wire, so nothing is hardcoded to a
    // particular vendor. A client that sends no clientInfo still gets a usable
    // row rather than a blank one.
    let client = params.as_ref().and_then(|p| p.get("clientInfo").cloned());
    let name = client
        .as_ref()
        .and_then(|c| c.get("name"))
        .and_then(|n| n.as_str())
        .filter(|n| !n.trim().is_empty())
        .map(|n| n.to_string())
        .or_else(|| {
            futures::executor::block_on(async { None })
        })
        .unwrap_or_else(|| "Unnamed agent".to_string());
    let version = client
        .as_ref()
        .and_then(|c| c.get("version"))
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());

    let agent = state.agents.upsert(agent_id, name, version).await;
    let _ = state.event_tx.send(WsEvent::AgentConnected { agent });

    JsonRpcResponse::success(
        id,
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": {
                "name": "claude-hive-agents",
                "version": env!("CARGO_PKG_VERSION")
            },
            "instructions": SERVER_INSTRUCTIONS
        }),
    )
}

fn handle_tools_list(id: Option<Value>) -> JsonRpcResponse {
    let tools: Vec<Value> = AGENT_TOOLS
        .iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": serde_json::from_str::<Value>(t.schema)
                    .expect("tool schema must be valid JSON")
            })
        })
        .collect();
    JsonRpcResponse::success(id, json!({ "tools": tools }))
}

async fn handle_tools_call(
    state: &AppState,
    agent_id: &str,
    id: Option<Value>,
    params: Option<Value>,
) -> JsonRpcResponse {
    let params = params.unwrap_or_else(|| json!({}));
    let tool = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    let Some(agent) = state.agents.get(agent_id).await else {
        return tool_error(id, "This token is not associated with a known agent.");
    };
    if !agent.enabled {
        return tool_error(
            id,
            "This agent is muted in Hive. Nothing you post will be shown until the user re-enables it.",
        );
    }
    state.agents.touch(agent_id).await;

    match tool {
        "agent_post" => {
            let Some(content) = args
                .get("content")
                .and_then(|c| c.as_str())
                .map(str::trim)
                .filter(|c| !c.is_empty())
            else {
                return tool_error(id, "agent_post requires a non-empty `content`.");
            };
            let app_id = args
                .get("app_id")
                .and_then(|a| a.as_str())
                .map(|a| a.to_string());
            let post_type: MessageType = args
                .get("type")
                .and_then(|t| t.as_str())
                .and_then(|t| serde_json::from_value(json!(t)).ok())
                .unwrap_or(MessageType::Info);

            let post = state
                .agent_feed
                .post(agent_id, &agent.name, app_id, content.to_string(), post_type)
                .await;
            let _ = state.event_tx.send(WsEvent::AgentPosted { post });
            text_result(id, "Posted.")
        }

        "agent_apps_sync" => {
            let apps: Vec<AgentApp> = args
                .get("apps")
                .cloned()
                .and_then(|a| serde_json::from_value(a).ok())
                .unwrap_or_default();
            let count = apps.len();
            state.agents.sync_apps(agent_id, apps.clone()).await;
            let _ = state.event_tx.send(WsEvent::AgentAppsChanged {
                agent_id: agent_id.to_string(),
                apps,
            });
            text_result(id, format!("{count} app(s) recorded."))
        }

        "agent_inbox" => {
            let replies = state.agent_feed.drain_replies(agent_id).await;
            if replies.is_empty() {
                return text_result(id, "No replies waiting.");
            }
            let body = replies
                .iter()
                .map(|r| format!("- {}", r.content))
                .collect::<Vec<_>>()
                .join("\n");
            text_result(id, format!("{} reply/replies from the user:\n{body}", replies.len()))
        }

        other => tool_error(id, format!("Unknown tool: {other}")),
    }
}
```

Remove the stray `.or_else(|| futures::executor::block_on(...))` from the name resolution — it does nothing and pulls in a blocking call. The name expression should read:

```rust
    let name = client
        .as_ref()
        .and_then(|c| c.get("name"))
        .and_then(|n| n.as_str())
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or("Unnamed agent")
        .to_string();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri; cargo test mcp::agent_dispatch`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/mcp/agent_tools.rs src-tauri/src/mcp/agent_dispatch.rs src-tauri/src/mcp/mod.rs
git commit -m "feat: MCP dispatch core for agent tools"
```

---

### Task 7: The /mcp HTTP endpoint

The thin shell: pull the bearer token, resolve it to an agent, hand off to `dispatch`.

**Files:**
- Create: `src-tauri/src/server/agent_routes.rs`
- Modify: `src-tauri/src/server/mod.rs`

**Interfaces:**
- Consumes: `dispatch` (Task 6), `AppState` (Task 5).
- Produces:
  - `async fn mcp_endpoint(State<AppState>, HeaderMap, Json<Value>) -> Response` on `POST /mcp`
  - `async fn list_agents(State<AppState>) -> Json<Vec<Agent>>` on `GET /api/agents`
  - `async fn agent_apps(State<AppState>) -> Json<Vec<AgentAppRow>>` on `GET /api/agents/apps`, where `AgentAppRow { agent_id, agent_name, app }`
  - `async fn agent_posts(State<AppState>, Query<PostsQuery>) -> Json<Vec<AgentPost>>` on `GET /api/agents/posts`
  - `async fn reply_to_agent(State<AppState>, Path<String>, Json<ReplyRequest>) -> StatusCode` on `POST /api/agents/{agent_id}/reply`
  - `async fn set_agent_enabled(...)` on `PUT /api/agents/{agent_id}/enabled`
  - `async fn agent_connection_info(State<AppState>) -> Json<ConnectionInfo>` on `GET /api/agents/connection` — endpoint URL, first token, and the prompt block, for the Agents pane
  - `fn bearer_token(headers: &HeaderMap) -> Option<&str>`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/server/agent_routes.rs` with the test module only:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn reads_a_bearer_token() {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", HeaderValue::from_static("Bearer hive_ag_abc"));
        assert_eq!(bearer_token(&headers), Some("hive_ag_abc"));
    }

    #[test]
    fn accepts_the_scheme_in_any_case() {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", HeaderValue::from_static("bearer hive_ag_abc"));
        assert_eq!(bearer_token(&headers), Some("hive_ag_abc"));
    }

    #[test]
    fn rejects_a_missing_or_malformed_header() {
        assert_eq!(bearer_token(&HeaderMap::new()), None);

        let mut basic = HeaderMap::new();
        basic.insert("authorization", HeaderValue::from_static("Basic abc"));
        assert_eq!(bearer_token(&basic), None);

        let mut bare = HeaderMap::new();
        bare.insert("authorization", HeaderValue::from_static("Bearer"));
        assert_eq!(bearer_token(&bare), None);

        let mut empty = HeaderMap::new();
        empty.insert("authorization", HeaderValue::from_static("Bearer   "));
        assert_eq!(bearer_token(&empty), None, "whitespace is not a token");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Add `pub mod agent_routes;` to `src-tauri/src/server/mod.rs`.

Run: `cd src-tauri; cargo test server::agent_routes`
Expected: FAIL — `bearer_token` not found.

- [ ] **Step 3: Write the routes**

Prepend to `src-tauri/src/server/agent_routes.rs`:

```rust
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::mcp::agent_dispatch::dispatch;
use crate::mcp::agent_tools::SERVER_INSTRUCTIONS;
use crate::models::{Agent, AgentApp, AgentPost};
use crate::server::app_state::AppState;

/// Extract a bearer token, tolerating case in the scheme as RFC 7235 requires.
pub fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let raw = headers.get("authorization")?.to_str().ok()?;
    let (scheme, token) = raw.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    let token = token.trim();
    (!token.is_empty()).then_some(token)
}

/// MCP over HTTP. The stdio server in `mcp/handler.rs` serves Claude Code,
/// which spawns it as a child process; an external agent has no such route in,
/// so it speaks JSON-RPC here instead.
pub async fn mcp_endpoint(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let Some(token) = bearer_token(&headers) else {
        return (
            StatusCode::UNAUTHORIZED,
            "missing Authorization: Bearer <token> header",
        )
            .into_response();
    };

    let agent_id = state.agent_tokens.read().await.agent_id_for(token);
    let Some(agent_id) = agent_id else {
        return (StatusCode::UNAUTHORIZED, "unknown token").into_response();
    };

    let method = body.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = body.get("id").cloned();
    let params = body.get("params").cloned();

    match dispatch(&state, &agent_id, method, id, params).await {
        Some(response) => Json(response).into_response(),
        // A notification: acknowledged, no body.
        None => StatusCode::ACCEPTED.into_response(),
    }
}

pub async fn list_agents(State(state): State<AppState>) -> Json<Vec<Agent>> {
    Json(state.agents.list().await)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppRow {
    pub agent_id: String,
    pub agent_name: String,
    #[serde(flatten)]
    pub app: AgentApp,
}

/// Every declared app with its owning agent, for the apps bar.
pub async fn agent_apps(State(state): State<AppState>) -> Json<Vec<AgentAppRow>> {
    let pairs = state.agents.all_apps().await;
    let mut rows = Vec::with_capacity(pairs.len());
    for (agent_id, app) in pairs {
        let agent_name = state
            .agents
            .get(&agent_id)
            .await
            .map(|a| a.name)
            .unwrap_or_else(|| "Unknown agent".to_string());
        rows.push(AgentAppRow { agent_id, agent_name, app });
    }
    Json(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostsQuery {
    pub app_id: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    100
}

pub async fn agent_posts(
    State(state): State<AppState>,
    Query(query): Query<PostsQuery>,
) -> Json<Vec<AgentPost>> {
    let limit = query.limit.clamp(1, 500);
    let posts = match query.app_id {
        Some(app_id) => state.agent_feed.for_app(&app_id, limit).await,
        None => state.agent_feed.recent(limit).await,
    };
    Json(posts)
}

#[derive(Debug, Deserialize)]
pub struct ReplyRequest {
    pub message: String,
}

/// Queue a reply for an agent to collect. It cannot be pushed: MCP is
/// request/response, so it waits here until the agent calls `agent_inbox`.
pub async fn reply_to_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    Json(request): Json<ReplyRequest>,
) -> StatusCode {
    if state.agents.get(&agent_id).await.is_none() {
        return StatusCode::NOT_FOUND;
    }
    if request.message.trim().is_empty() {
        return StatusCode::BAD_REQUEST;
    }
    state
        .agent_feed
        .enqueue_reply(&agent_id, request.message)
        .await;
    StatusCode::ACCEPTED
}

#[derive(Debug, Deserialize)]
pub struct EnabledRequest {
    pub enabled: bool,
}

pub async fn set_agent_enabled(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    Json(request): Json<EnabledRequest>,
) -> StatusCode {
    if state.agents.set_enabled(&agent_id, request.enabled).await {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub endpoint: String,
    pub token: Option<String>,
    pub prompt_block: String,
}

/// What the Agents pane hands the user: where to point the agent, a token, and
/// the prompt that makes it actually post.
pub async fn agent_connection_info(State(state): State<AppState>) -> Json<ConnectionInfo> {
    let port = std::env::var("CLAUDE_HIVE_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(9400);

    let token = state
        .agent_tokens
        .read()
        .await
        .tokens()
        .into_iter()
        .map(|(token, _)| token)
        .next();

    Json(ConnectionInfo {
        endpoint: format!("http://127.0.0.1:{port}/mcp"),
        token,
        prompt_block: SERVER_INSTRUCTIONS.to_string(),
    })
}
```

- [ ] **Step 4: Register the routes**

In `src-tauri/src/server/mod.rs`, add to the `use` list and the router:

```rust
use agent_routes::*;
```

```rust
        .route("/mcp", post(mcp_endpoint))
        .route("/api/agents", get(list_agents))
        .route("/api/agents/apps", get(agent_apps))
        .route("/api/agents/posts", get(agent_posts))
        .route("/api/agents/connection", get(agent_connection_info))
        .route("/api/agents/{agent_id}/reply", post(reply_to_agent))
        .route("/api/agents/{agent_id}/enabled", put(set_agent_enabled))
```

Note the `{agent_id}` brace syntax — axum 0.8, matching the existing session routes.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri; cargo test server::agent_routes`
Expected: PASS, 3 tests.

Then the whole suite: `cargo test`
Expected: everything green, including phases 1–2.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/server/agent_routes.rs src-tauri/src/server/mod.rs
git commit -m "feat: /mcp endpoint and agent HTTP routes"
```

---

### Task 8: End-to-end verification against a running Hive

The tests cover every branch in isolation. This proves the wiring: a real HTTP client completing an MCP handshake and posting.

**Files:**
- Create: `src-tauri/tests/agent_ingest.md` (a documented curl transcript, committed as the manual verification record)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code depends on.

- [ ] **Step 1: Start Hive on an isolated port**

The default port is 9400 and a running Hive holds it with `.expect()`, so use another.

```bash
cd src-tauri
CLAUDE_HIVE_PORT=9456 ./target/debug/claude-hive.exe > /tmp/claude/agent-test.log 2>&1 &
```

- [ ] **Step 2: Read the token the way the pane will**

```bash
curl -s http://127.0.0.1:9456/api/agents/connection | tee /tmp/claude/conn.json
```

Expected: JSON with `endpoint`, `token` starting `hive_ag_`, and `promptBlock`.

- [ ] **Step 3: Reject an unauthenticated call**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:9456/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
```

Expected: `401`. Then repeat with `-H "authorization: Bearer wrong"` — also `401`.

- [ ] **Step 4: Complete a handshake and confirm the agent is named from clientInfo**

```bash
TOKEN=$(node -e "console.log(require('/tmp/claude/conn.json').token)")
curl -s -X POST http://127.0.0.1:9456/mcp \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"Grok","version":"2.1"}}}'
curl -s http://127.0.0.1:9456/api/agents
```

Expected: the initialize result carries `instructions` mentioning `agent_post`; `/api/agents` shows one agent named `Grok`.

- [ ] **Step 5: Declare apps, post, and read it back**

```bash
curl -s -X POST http://127.0.0.1:9456/mcp \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"agent_apps_sync","arguments":{"apps":[{"id":"gmail","label":"Gmail"},{"id":"x","label":"X"}]}}}'

curl -s -X POST http://127.0.0.1:9456/mcp \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"agent_post","arguments":{"content":"Tauri v3 alpha dropped","app_id":"x"}}}'

curl -s http://127.0.0.1:9456/api/agents/apps
curl -s "http://127.0.0.1:9456/api/agents/posts?appId=x"
```

Expected: two apps listed with their agent, and one post attributed to `x`.

- [ ] **Step 6: Round-trip a reply**

```bash
AGENT=$(curl -s http://127.0.0.1:9456/api/agents | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)[0].id))")
curl -s -X POST "http://127.0.0.1:9456/api/agents/$AGENT/reply" \
  -H "content-type: application/json" -d '{"message":"dig into the tauri change"}'

curl -s -X POST http://127.0.0.1:9456/mcp \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"agent_inbox","arguments":{}}}'
```

Expected: the first `agent_inbox` returns the reply text; running it again returns "No replies waiting."

- [ ] **Step 7: Confirm the token survives a restart**

Kill the process, start it again on 9456, and re-run Step 2. The token must be identical — a changed token would mean every agent the user configured has silently stopped working.

- [ ] **Step 8: Record the transcript and commit**

Write the commands and their actual output to `src-tauri/tests/agent_ingest.md`, then stop the test instance.

```bash
git add src-tauri/tests/agent_ingest.md
git commit -m "docs: end-to-end verification transcript for agent ingest"
```

---

## Self-review

**Spec coverage.** `agent_hello` is folded into `initialize` (Task 6) rather than being a separate tool — the handshake already carries `clientInfo`, so a second call would be ceremony. `agent_apps_sync`, `agent_post`, `agent_inbox` → Task 6. Per-agent tokens → Task 3, with persistence, which the spec put in phase 4 but which is unavoidable here: a token the user pastes into an agent must survive a restart. Registration-is-implicit → Task 6's `initialize` upsert. Auto-add of undeclared apps is **not** implemented: `agent_post` accepts an `app_id` that was never declared and the post keeps it, but no app row appears. That is a deliberate cut — the setting for it is phase 3b's UI, and the safety net is only meaningful once there is a bar to be missing from. Flagged rather than silently dropped.

**Deferred, with the phase that owns each:** `agent_ask` (needs `QuestionStore` generalised past session ids); persistence of posts (phase 4, with tasks); everything visual (phase 3b); `tasks_*` (phase 4).

**Placeholder scan.** No TBD or "add error handling". Two places deliberately correct the code inline rather than leaving it wrong — Task 2's `into_pair()` line and Task 6's stray `or_else(block_on)` — because both are mistakes a reader would otherwise copy. Task 8 has no unit tests by design and says so.

**Type consistency.** `MessageType` is reused for `AgentPost::post_type` rather than inventing a parallel enum, so the frontend's existing message-type handling applies. `AgentApp` is the same type in the registry, the sync tool, the WS event and `AgentAppRow`. `dispatch`'s signature `(&AppState, &str, &str, Option<Value>, Option<Value>) -> Option<JsonRpcResponse>` matches its single caller in Task 7. Route paths use axum 0.8 `{param}` braces, matching `server/mod.rs`. `bearer_token` returns `Option<&str>` and its caller immediately converts via the token map, so no lifetime escapes.

**One risk worth naming.** `AGENT_TOOLS` reuses `ToolDef` from `mcp/types.rs`, which is `pub` but currently only consumed by the stdio handler. If a future change makes `MCP_TOOLS` and `AGENT_TOOLS` diverge in shape, both call sites must move together.

## Execution handoff

Phase 3b (apps bar, merged feed, per-app filtering, composer with reply queue, Agents pane, icon set) gets its own plan once this backend is verified — its components consume the exact route shapes above, so writing it before they exist would be guesswork.
