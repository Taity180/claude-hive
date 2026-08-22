# Hive Agent Rail — Phase 4: Tasks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A checkable task list that agents fill from the apps they are connected to, with source provenance, date filters, collapsible notes, and honest attribution when an agent completes something.

**Architecture:** Tasks are the first thing in Hive that must survive a restart, so `TaskStore` writes through to a JSON file on every mutation rather than saving on exit. Upserts key on a stable `external_id` so an agent re-reading the same email thread updates one task instead of creating five — the single most important behaviour in the feature. Grouping and date filtering live in a pure function over `(tasks, range, now)`, tested directly; `now` is injected so the tests are not time-dependent.

**Tech Stack:** Rust 2021, axum 0.8, chrono, serde_json; React 19, TypeScript 5.8, Zustand 5, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-08-22-hive-agent-rail-design.md`

**Depends on:** Phases 3a and 3b.

## Global Constraints

- **Idempotency is the headline requirement.** `tasks_upsert` with the same `external_id` must update, never duplicate. This gets tested first and hardest.
- **Persistence is write-through**, not write-on-exit. A crash must not cost a day of ticked boxes.
- **Every task keeps its source.** Without the app chip, a task an agent invented is indistinguishable from one out of a real email, and the list stops being trustworthy.
- **Agent completions are labelled, never silent.** An agent ticking something off shows as "Completed by *agent*"; the user's own completion gets a plain timestamp. The two must never look alike.
- **Undated tasks get their own group, visible in every filter.** An agent finding "reply to Sarah" has no deadline to read, and letting it invent one would put a fake deadline on the user's list.
- **Only the user may create a task by hand**; agents push. Both may complete, both may note.
- **Agents render monochrome** (phase 3b constraint) — that applies to the "completed by" chip too, which uses the accent, not a status colour.
- **Test isolation:** any test touching `AppState` or a store uses a `tempfile::tempdir()`, never the real config dir.
- **Test commands:** `cd src-tauri && cargo test <name>`; `pnpm vitest run <path>`; `pnpm build`.
- **Windows/PowerShell:** chain with `;`. **Commits:** no `Co-Authored-By`.

## Scope

**In:** the task model, persistent store, four `tasks_*` MCP tools, HTTP routes, and the Tasks pane with filters, notes and attribution.

**Out:** `agent_ask` (needs `QuestionStore` generalised past session ids); combined mode and the settings UI (phase 5); task *editing* beyond notes and completion — retitling or re-dating a task by hand is not in the spec and is not built.

---

### Task 1: Task models

**Files:** Create `src-tauri/src/models/task.rs`; modify `src-tauri/src/models/mod.rs`, `src-tauri/src/models/events.rs`.

**Produces:**
- `Task { id, external_id: Option<String>, agent_id: Option<String>, title, app_id: Option<String>, source_label: Option<String>, due: Option<DateTime<Utc>>, done: bool, completed_by: Option<Actor>, completed_at: Option<DateTime<Utc>>, notes: Vec<TaskNote>, created_at, updated_at }`
- `TaskNote { id, author: Actor, body, created_at }`
- `enum Actor { User, Agent { id: String, name: String } }` — `#[serde(tag = "kind", rename_all = "snake_case")]`
- `WsEvent` gains `TaskUpserted { task }` and `TaskRemoved { task_id }`

- [ ] **Step 1: Write the failing test**

Test module at the bottom of `src-tauri/src/models/task.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_actor_says_which_kind_it_is() {
        // The frontend has to tell "you ticked this" from "an agent ticked
        // this", so the tag is load-bearing, not decoration.
        let user = serde_json::to_value(Actor::User).unwrap();
        assert_eq!(user["kind"], "user");

        let agent = serde_json::to_value(Actor::Agent {
            id: "a1".into(),
            name: "Grok".into(),
        })
        .unwrap();
        assert_eq!(agent["kind"], "agent");
        assert_eq!(agent["name"], "Grok");
    }

    #[test]
    fn a_task_serialises_camel_case_with_no_notes_by_default() {
        let task: Task = serde_json::from_str(r#"{"id":"t1","title":"Reply to Sarah"}"#).unwrap();
        assert_eq!(task.title, "Reply to Sarah");
        assert!(task.notes.is_empty());
        assert!(!task.done);
        assert!(task.due.is_none(), "no due date is a real state, not a default of now");

        let json = serde_json::to_value(&task).unwrap();
        assert!(json.get("externalId").is_some());
        assert!(json.get("external_id").is_none());
    }

    #[test]
    fn a_note_carries_its_author() {
        let note = TaskNote::new(Actor::User, "waiting on the export".into());
        assert!(matches!(note.author, Actor::User));
        assert!(!note.id.is_empty());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Add `pub mod task;` and `pub use task::*;` to `models/mod.rs`.
Run: `cd src-tauri; cargo test models::task` — FAIL, types not found.

- [ ] **Step 3: Write the models**

Prepend to `src-tauri/src/models/task.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Who did something — the user, or a named agent.
///
/// Tagged so the frontend can distinguish them. An agent completing the user's
/// work silently would be a trust problem; the label is the whole point.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Actor {
    User,
    Agent { id: String, name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskNote {
    pub id: String,
    pub author: Actor,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

impl TaskNote {
    pub fn new(author: Actor, body: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            author,
            body,
            created_at: Utc::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    /// Stable key the pushing agent chooses, e.g. "gmail:thread-abc". The
    /// upsert dedupes on this: without it, an agent re-reading the same email
    /// thread creates a new task every run.
    #[serde(default)]
    pub external_id: Option<String>,
    /// None for a task the user typed.
    #[serde(default)]
    pub agent_id: Option<String>,
    pub title: String,
    /// Slug of the app it came from, for the provenance chip and its icon.
    #[serde(default)]
    pub app_id: Option<String>,
    /// What it came from, e.g. "Re: Q3 invoicing".
    #[serde(default)]
    pub source_label: Option<String>,
    /// Genuinely optional: an agent finding "reply to Sarah" has no deadline to
    /// read, and inventing one would put a fake deadline on the user's list.
    #[serde(default)]
    pub due: Option<DateTime<Utc>>,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub completed_by: Option<Actor>,
    #[serde(default)]
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub notes: Vec<TaskNote>,
    #[serde(default = "Utc::now")]
    pub created_at: DateTime<Utc>,
    #[serde(default = "Utc::now")]
    pub updated_at: DateTime<Utc>,
}

impl Task {
    pub fn new(title: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            external_id: None,
            agent_id: None,
            title,
            app_id: None,
            source_label: None,
            due: None,
            done: false,
            completed_by: None,
            completed_at: None,
            notes: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }
}
```

- [ ] **Step 4: Add the websocket events**

In `models/events.rs`, extend the `use` line with `Task` and add:

```rust
    #[serde(rename_all = "camelCase")]
    TaskUpserted { task: Task },
    #[serde(rename_all = "camelCase")]
    TaskRemoved { task_id: String },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri; cargo test models::task` — PASS, 3 tests. Then `cargo test`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/models/
git commit -m "feat: task, note and actor models"
```

---

### Task 2: The persistent task store

The first store in Hive that survives a restart.

**Files:** Create `src-tauri/src/state/task_store.rs`; modify `src-tauri/src/state/mod.rs`.

**Produces** `TaskStore` with `load_or_create(dir)`, and async `upsert_from_agent`, `create_for_user`, `list`, `get`, `set_done`, `add_note`, `remove`.

- [ ] **Step 1: Write the failing test**

Test module in `src-tauri/src/state/task_store.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (TaskStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        (TaskStore::load_or_create(dir.path()), dir)
    }

    fn grok() -> Actor {
        Actor::Agent { id: "a1".into(), name: "Grok".into() }
    }

    #[tokio::test]
    async fn the_same_external_id_updates_instead_of_duplicating() {
        // THE test for this feature. An agent re-reading the same email thread
        // must update one task, not add another every run.
        let (store, _dir) = store();
        store
            .upsert_from_agent("a1", Some("gmail:thread-1".into()), "Reply to Sarah".into(), None, None, None)
            .await;
        store
            .upsert_from_agent("a1", Some("gmail:thread-1".into()), "Reply to Sarah about Q3".into(), None, None, None)
            .await;

        let tasks = store.list().await;
        assert_eq!(tasks.len(), 1, "one thread, one task");
        assert_eq!(tasks[0].title, "Reply to Sarah about Q3", "the newer title wins");
    }

    #[tokio::test]
    async fn different_external_ids_are_different_tasks() {
        let (store, _dir) = store();
        store.upsert_from_agent("a1", Some("gmail:1".into()), "One".into(), None, None, None).await;
        store.upsert_from_agent("a1", Some("gmail:2".into()), "Two".into(), None, None, None).await;
        assert_eq!(store.list().await.len(), 2);
    }

    #[tokio::test]
    async fn the_same_external_id_from_a_different_agent_is_a_different_task() {
        // Two agents watching the same inbox are not the same source of truth.
        let (store, _dir) = store();
        store.upsert_from_agent("a1", Some("gmail:1".into()), "From Grok".into(), None, None, None).await;
        store.upsert_from_agent("a2", Some("gmail:1".into()), "From Ops".into(), None, None, None).await;
        assert_eq!(store.list().await.len(), 2);
    }

    #[tokio::test]
    async fn a_push_without_an_external_id_cannot_dedupe_and_says_so() {
        let (store, _dir) = store();
        store.upsert_from_agent("a1", None, "Untracked".into(), None, None, None).await;
        store.upsert_from_agent("a1", None, "Untracked".into(), None, None, None).await;
        // Nothing to key on, so two tasks. The tool description tells agents to
        // always send one; this documents what happens when they do not.
        assert_eq!(store.list().await.len(), 2);
    }

    #[tokio::test]
    async fn an_upsert_preserves_the_users_work() {
        // An agent re-pushing must not un-tick a box or wipe a note.
        let (store, _dir) = store();
        let task = store
            .upsert_from_agent("a1", Some("k".into()), "Thing".into(), None, None, None)
            .await;
        store.set_done(&task.id, true, Actor::User).await;
        store.add_note(&task.id, Actor::User, "my note".into()).await;

        store.upsert_from_agent("a1", Some("k".into()), "Thing renamed".into(), None, None, None).await;

        let after = store.get(&task.id).await.unwrap();
        assert!(after.done, "completion survives a re-push");
        assert_eq!(after.notes.len(), 1, "notes survive a re-push");
        assert_eq!(after.title, "Thing renamed");
    }

    #[tokio::test]
    async fn completion_records_who_did_it() {
        let (store, _dir) = store();
        let a = store.create_for_user("Mine".into(), None).await;
        let b = store.create_for_user("Theirs".into(), None).await;

        store.set_done(&a.id, true, Actor::User).await;
        store.set_done(&b.id, true, grok()).await;

        assert!(matches!(store.get(&a.id).await.unwrap().completed_by, Some(Actor::User)));
        assert!(matches!(
            store.get(&b.id).await.unwrap().completed_by,
            Some(Actor::Agent { .. })
        ));
    }

    #[tokio::test]
    async fn unticking_clears_the_attribution() {
        let (store, _dir) = store();
        let task = store.create_for_user("Thing".into(), None).await;
        store.set_done(&task.id, true, grok()).await;
        store.set_done(&task.id, false, Actor::User).await;

        let after = store.get(&task.id).await.unwrap();
        assert!(!after.done);
        assert!(after.completed_by.is_none(), "a reopened task has no completer");
        assert!(after.completed_at.is_none());
    }

    #[tokio::test]
    async fn notes_keep_their_order_and_authors() {
        let (store, _dir) = store();
        let task = store.create_for_user("Thing".into(), None).await;
        store.add_note(&task.id, Actor::User, "mine".into()).await;
        store.add_note(&task.id, grok(), "theirs".into()).await;

        let notes = store.get(&task.id).await.unwrap().notes;
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].body, "mine", "oldest first");
        assert!(matches!(notes[1].author, Actor::Agent { .. }));
    }

    #[tokio::test]
    async fn everything_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let first = TaskStore::load_or_create(dir.path());
        let task = first
            .upsert_from_agent("a1", Some("k".into()), "Persisted".into(), None, None, None)
            .await;
        first.add_note(&task.id, Actor::User, "note".into()).await;
        first.set_done(&task.id, true, Actor::User).await;

        // Write-through, not write-on-exit: a crash must not cost the day's work.
        let second = TaskStore::load_or_create(dir.path());
        let reloaded = second.get(&task.id).await.expect("task must survive");
        assert!(reloaded.done);
        assert_eq!(reloaded.notes.len(), 1);
    }

    #[tokio::test]
    async fn a_corrupt_file_starts_empty_rather_than_refusing_to_boot() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("tasks.json"), "{not json").unwrap();
        let store = TaskStore::load_or_create(dir.path());
        assert!(store.list().await.is_empty());
    }

    #[tokio::test]
    async fn removing_a_task_is_permanent() {
        let (store, _dir) = store();
        let task = store.create_for_user("Thing".into(), None).await;
        assert!(store.remove(&task.id).await);
        assert!(store.get(&task.id).await.is_none());
        assert!(!store.remove(&task.id).await, "removing twice reports false");
    }

    #[tokio::test]
    async fn operations_on_an_unknown_id_are_not_panics() {
        let (store, _dir) = store();
        assert!(store.get("nope").await.is_none());
        assert!(!store.set_done("nope", true, Actor::User).await);
        assert!(!store.add_note("nope", Actor::User, "x".into()).await);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Add to `state/mod.rs`:

```rust
pub mod task_store;
pub use task_store::TaskStore;
```

Run: `cd src-tauri; cargo test state::task_store` — FAIL, `TaskStore` not found.

- [ ] **Step 3: Write the store**

Prepend to `src-tauri/src/state/task_store.rs`:

```rust
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use tokio::sync::RwLock;

use crate::models::{Actor, Task, TaskNote};

const FILE_NAME: &str = "tasks.json";

/// Tasks, persisted to disk.
///
/// The first store in Hive that survives a restart. Writes happen on every
/// mutation rather than on exit: a task list that empties when the app crashes
/// is worse than no task list.
#[derive(Debug, Clone)]
pub struct TaskStore {
    tasks: Arc<RwLock<HashMap<String, Task>>>,
    path: Arc<PathBuf>,
}

impl TaskStore {
    pub fn load_or_create(dir: &Path) -> Self {
        let path = dir.join(FILE_NAME);
        let loaded: HashMap<String, Task> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<Task>>(&raw).ok())
            .map(|list| list.into_iter().map(|t| (t.id.clone(), t)).collect())
            // Unreadable or corrupt: start empty rather than refuse to boot.
            .unwrap_or_default();

        Self {
            tasks: Arc::new(RwLock::new(loaded)),
            path: Arc::new(path),
        }
    }

    /// Write the whole file. Called after every mutation.
    ///
    /// Rewriting everything is fine at this scale — a task list is tens of
    /// rows, not thousands — and it avoids the partial-write problems an
    /// append-only format would bring.
    async fn persist(&self) {
        let snapshot: Vec<Task> = self.tasks.read().await.values().cloned().collect();
        let path = self.path.clone();
        let json = match serde_json::to_string_pretty(&snapshot) {
            Ok(json) => json,
            Err(e) => {
                tracing::error!("tasks: could not serialise: {e}");
                return;
            }
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(path.as_path(), json) {
            // Losing the write is bad, but taking the dashboard down with it is
            // worse. The in-memory list stays correct for this session.
            tracing::error!("tasks: could not write {}: {e}", path.display());
        }
    }

    /// Create or update a task an agent pushed.
    ///
    /// Dedupes on `(agent_id, external_id)`. Two agents watching the same inbox
    /// are not the same source of truth, so the agent is part of the key.
    ///
    /// An update deliberately touches only the agent-owned fields: the title,
    /// source and due date. Completion state and notes are the user's, and an
    /// agent re-pushing must never un-tick a box or wipe a note.
    pub async fn upsert_from_agent(
        &self,
        agent_id: &str,
        external_id: Option<String>,
        title: String,
        app_id: Option<String>,
        source_label: Option<String>,
        due: Option<DateTime<Utc>>,
    ) -> Task {
        let mut tasks = self.tasks.write().await;

        let existing_id = external_id.as_ref().and_then(|key| {
            tasks
                .values()
                .find(|t| {
                    t.agent_id.as_deref() == Some(agent_id)
                        && t.external_id.as_deref() == Some(key.as_str())
                })
                .map(|t| t.id.clone())
        });

        let task = match existing_id {
            Some(id) => {
                let task = tasks.get_mut(&id).expect("just found it");
                task.title = title;
                task.app_id = app_id;
                task.source_label = source_label;
                task.due = due;
                task.updated_at = Utc::now();
                task.clone()
            }
            None => {
                let mut task = Task::new(title);
                task.external_id = external_id;
                task.agent_id = Some(agent_id.to_string());
                task.app_id = app_id;
                task.source_label = source_label;
                task.due = due;
                tasks.insert(task.id.clone(), task.clone());
                task
            }
        };

        drop(tasks);
        self.persist().await;
        task
    }

    pub async fn create_for_user(&self, title: String, due: Option<DateTime<Utc>>) -> Task {
        let mut task = Task::new(title);
        task.due = due;
        self.tasks.write().await.insert(task.id.clone(), task.clone());
        self.persist().await;
        task
    }

    pub async fn list(&self) -> Vec<Task> {
        self.tasks.read().await.values().cloned().collect()
    }

    pub async fn get(&self, id: &str) -> Option<Task> {
        self.tasks.read().await.get(id).cloned()
    }

    /// Tick or un-tick, recording who did it.
    ///
    /// Reopening clears the attribution: a task that is not done was not
    /// completed by anybody, and leaving a stale completer would misreport it.
    pub async fn set_done(&self, id: &str, done: bool, by: Actor) -> bool {
        {
            let mut tasks = self.tasks.write().await;
            let Some(task) = tasks.get_mut(id) else {
                return false;
            };
            task.done = done;
            task.completed_by = if done { Some(by) } else { None };
            task.completed_at = if done { Some(Utc::now()) } else { None };
            task.updated_at = Utc::now();
        }
        self.persist().await;
        true
    }

    pub async fn add_note(&self, id: &str, author: Actor, body: String) -> bool {
        {
            let mut tasks = self.tasks.write().await;
            let Some(task) = tasks.get_mut(id) else {
                return false;
            };
            task.notes.push(TaskNote::new(author, body));
            task.updated_at = Utc::now();
        }
        self.persist().await;
        true
    }

    pub async fn remove(&self, id: &str) -> bool {
        let removed = self.tasks.write().await.remove(id).is_some();
        if removed {
            self.persist().await;
        }
        removed
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri; cargo test state::task_store` — PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state/
git commit -m "feat: write-through persistent task store"
```

---

### Task 3: Wire TaskStore into AppState

**Files:** Modify `src-tauri/src/server/app_state.rs`.

- [ ] **Step 1: Write the failing test**

Add to the existing tests module:

```rust
    #[tokio::test]
    async fn a_fresh_state_has_an_empty_task_list() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::with_token_dir(dir.path());
        assert!(state.tasks.list().await.is_empty());
    }
```

- [ ] **Step 2: Run to verify it fails** — `cargo test server::app_state`, no field `tasks`.

- [ ] **Step 3: Add the field**

Add `TaskStore` to the `use crate::state::{...}` list, `pub tasks: TaskStore,` to the struct, and in `with_token_dir` (which already receives the directory) `tasks: TaskStore::load_or_create(dir),`.

- [ ] **Step 4: Run to verify it passes** — `cargo test server::app_state`, then `cargo test`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/server/app_state.rs
git commit -m "feat: hold the task store in AppState"
```

---

### Task 4: The tasks_* MCP tools

**Files:** Modify `src-tauri/src/mcp/agent_tools.rs`, `src-tauri/src/mcp/agent_dispatch.rs`.

**Produces:** `tasks_upsert`, `tasks_list`, `tasks_complete`, `tasks_note` in `AGENT_TOOLS`, handled in `handle_tools_call`.

- [ ] **Step 1: Write the failing test**

Add to `agent_dispatch.rs`'s tests:

```rust
    #[tokio::test]
    async fn tasks_upsert_creates_a_task_with_its_source() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;

        let value = call(&state, "tasks_upsert", json!({
            "external_id": "gmail:thread-1",
            "title": "Send Sarah the Q3 rates breakdown",
            "app_id": "gmail",
            "source_label": "Re: Q3 invoicing"
        })).await;
        assert!(value["result"]["isError"].is_null(), "unexpected error: {value}");

        let tasks = state.tasks.list().await;
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].app_id.as_deref(), Some("gmail"));
        assert_eq!(tasks[0].source_label.as_deref(), Some("Re: Q3 invoicing"));
    }

    #[tokio::test]
    async fn tasks_upsert_is_idempotent_over_the_wire() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let args = json!({ "external_id": "gmail:1", "title": "Reply" });

        call(&state, "tasks_upsert", args.clone()).await;
        call(&state, "tasks_upsert", args).await;

        assert_eq!(state.tasks.list().await.len(), 1, "one thread, one task");
    }

    #[tokio::test]
    async fn tasks_upsert_requires_a_title() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let value = call(&state, "tasks_upsert", json!({ "external_id": "k" })).await;
        assert!(value["result"]["isError"].as_bool().unwrap_or(false));
        assert!(state.tasks.list().await.is_empty());
    }

    #[tokio::test]
    async fn tasks_upsert_accepts_an_iso_due_date_and_rejects_nonsense() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;

        call(&state, "tasks_upsert", json!({
            "external_id": "k1", "title": "Dated", "due": "2026-08-28T09:00:00Z"
        })).await;
        let dated = state.tasks.list().await;
        assert!(dated[0].due.is_some());

        // A due date we cannot parse must not become "now" — a fake deadline is
        // worse than none.
        call(&state, "tasks_upsert", json!({
            "external_id": "k2", "title": "Bad date", "due": "next tuesday"
        })).await;
        let task = state.tasks.list().await.into_iter().find(|t| t.title == "Bad date").unwrap();
        assert!(task.due.is_none());
    }

    #[tokio::test]
    async fn tasks_list_returns_what_the_user_has_done() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let task = state.tasks.create_for_user("Mine".into(), None).await;
        state.tasks.set_done(&task.id, true, crate::models::Actor::User).await;
        state.tasks.add_note(&task.id, crate::models::Actor::User, "my note".into()).await;

        let value = call(&state, "tasks_list", json!({})).await;
        let text = value["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("Mine"));
        assert!(text.contains("my note"), "the agent should see the user's notes");
    }

    #[tokio::test]
    async fn tasks_complete_is_attributed_to_the_agent() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let task = state.tasks.create_for_user("Thing".into(), None).await;

        call(&state, "tasks_complete", json!({ "task_id": task.id })).await;

        let after = state.tasks.get(&task.id).await.unwrap();
        assert!(after.done);
        match after.completed_by {
            Some(crate::models::Actor::Agent { ref name, .. }) => assert_eq!(name, "Grok"),
            other => panic!("expected agent attribution, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn tasks_note_is_attributed_and_does_not_complete_anything() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let task = state.tasks.create_for_user("Thing".into(), None).await;

        call(&state, "tasks_note", json!({ "task_id": task.id, "body": "export finished" })).await;

        let after = state.tasks.get(&task.id).await.unwrap();
        assert_eq!(after.notes.len(), 1);
        assert!(matches!(after.notes[0].author, crate::models::Actor::Agent { .. }));
        assert!(!after.done, "a note is not a completion");
    }

    #[tokio::test]
    async fn task_tools_on_an_unknown_task_report_an_error() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let value = call(&state, "tasks_complete", json!({ "task_id": "nope" })).await;
        assert!(value["result"]["isError"].as_bool().unwrap_or(false));
    }

    #[tokio::test]
    async fn a_muted_agent_cannot_push_tasks() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        state.agents.set_enabled("a1", false).await;
        let value = call(&state, "tasks_upsert", json!({ "title": "Sneaky" })).await;
        assert!(value["result"]["isError"].as_bool().unwrap_or(false));
        assert!(state.tasks.list().await.is_empty());
    }
```

- [ ] **Step 2: Run to verify it fails** — `cargo test mcp::agent_dispatch`, unknown tool errors.

- [ ] **Step 3: Add the tool definitions**

Append to `AGENT_TOOLS` in `agent_tools.rs`:

```rust
    ToolDef {
        name: "tasks_upsert",
        description: "Add or update something the user needs to do, found in a connected app. ALWAYS pass a stable external_id — without one, re-reading the same email or issue creates a duplicate task every run. Only include a due date the source actually states; do not invent one.",
        schema: r#"{
            "type": "object",
            "properties": {
                "external_id": { "type": "string", "description": "Stable key for the thing this came from, e.g. \"gmail:thread-abc\". Send the same value next run to update rather than duplicate." },
                "title": { "type": "string", "description": "What the user has to do, as an imperative." },
                "app_id": { "type": "string", "description": "Slug of the app it came from, matching agent_apps_sync." },
                "source_label": { "type": "string", "description": "What it came from, e.g. \"Re: Q3 invoicing\". Shown to the user as provenance." },
                "due": { "type": "string", "description": "ISO-8601 timestamp. Omit unless the source states a deadline." }
            },
            "required": ["title"]
        }"#,
    },
    ToolDef {
        name: "tasks_list",
        description: "Read the user's tasks, including which are done and any notes they have written. Call before pushing, to see what they have already dealt with.",
        schema: r#"{
            "type": "object",
            "properties": {
                "include_done": { "type": "boolean", "default": true }
            }
        }"#,
    },
    ToolDef {
        name: "tasks_complete",
        description: "Mark a task done. Only when you have actually done it or confirmed it is done — the user sees your name against it, so a wrong completion is worse than none.",
        schema: r#"{
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "done": { "type": "boolean", "default": true }
            },
            "required": ["task_id"]
        }"#,
    },
    ToolDef {
        name: "tasks_note",
        description: "Add context to a task without changing whether it is done. Use for what you found out, e.g. that a blocker has cleared.",
        schema: r#"{
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "body": { "type": "string" }
            },
            "required": ["task_id", "body"]
        }"#,
    },
```

Also extend `SERVER_INSTRUCTIONS` with a tasks line:

```
- tasks_upsert — whenever an app shows something the user must do. Always with \
a stable external_id, or you will duplicate it next run.
```

- [ ] **Step 4: Handle them in dispatch**

In `agent_dispatch.rs`, add to the `match tool` block. `Actor` and `DateTime` need importing.

```rust
        "tasks_upsert" => {
            let Some(title) = args
                .get("title")
                .and_then(|t| t.as_str())
                .map(str::trim)
                .filter(|t| !t.is_empty())
            else {
                return tool_error(id, "tasks_upsert requires a non-empty `title`.");
            };
            let external_id = args
                .get("external_id")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let app_id = args.get("app_id").and_then(|v| v.as_str()).map(String::from);
            let source_label = args
                .get("source_label")
                .and_then(|v| v.as_str())
                .map(String::from);
            // An unparseable due date becomes no due date. Guessing would put a
            // deadline on the user's list that nothing actually stated.
            let due = args
                .get("due")
                .and_then(|v| v.as_str())
                .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
                .map(|dt| dt.with_timezone(&chrono::Utc));

            let task = state
                .tasks
                .upsert_from_agent(
                    agent_id,
                    external_id,
                    title.to_string(),
                    app_id,
                    source_label,
                    due,
                )
                .await;
            let _ = state.event_tx.send(WsEvent::TaskUpserted { task });
            text_result(id, "Task recorded.")
        }

        "tasks_list" => {
            let include_done = args
                .get("include_done")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let mut tasks = state.tasks.list().await;
            tasks.retain(|t| include_done || !t.done);
            if tasks.is_empty() {
                return text_result(id, "No tasks.");
            }
            let body = tasks
                .iter()
                .map(|t| {
                    let mark = if t.done { "[x]" } else { "[ ]" };
                    let notes = if t.notes.is_empty() {
                        String::new()
                    } else {
                        format!(
                            "\n    notes: {}",
                            t.notes
                                .iter()
                                .map(|n| n.body.as_str())
                                .collect::<Vec<_>>()
                                .join(" | ")
                        )
                    };
                    format!("{mark} {} (id {}){notes}", t.title, t.id)
                })
                .collect::<Vec<_>>()
                .join("\n");
            text_result(id, body)
        }

        "tasks_complete" => {
            let Some(task_id) = args.get("task_id").and_then(|v| v.as_str()) else {
                return tool_error(id, "tasks_complete requires `task_id`.");
            };
            let done = args.get("done").and_then(|v| v.as_bool()).unwrap_or(true);
            let actor = Actor::Agent {
                id: agent_id.to_string(),
                name: agent.name.clone(),
            };
            if !state.tasks.set_done(task_id, done, actor).await {
                return tool_error(id, format!("No task with id {task_id}."));
            }
            if let Some(task) = state.tasks.get(task_id).await {
                let _ = state.event_tx.send(WsEvent::TaskUpserted { task });
            }
            text_result(id, "Task updated.")
        }

        "tasks_note" => {
            let Some(task_id) = args.get("task_id").and_then(|v| v.as_str()) else {
                return tool_error(id, "tasks_note requires `task_id`.");
            };
            let Some(body) = args
                .get("body")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|b| !b.is_empty())
            else {
                return tool_error(id, "tasks_note requires a non-empty `body`.");
            };
            let actor = Actor::Agent {
                id: agent_id.to_string(),
                name: agent.name.clone(),
            };
            if !state.tasks.add_note(task_id, actor, body.to_string()).await {
                return tool_error(id, format!("No task with id {task_id}."));
            }
            if let Some(task) = state.tasks.get(task_id).await {
                let _ = state.event_tx.send(WsEvent::TaskUpserted { task });
            }
            text_result(id, "Note added.")
        }
```

- [ ] **Step 5: Run to verify it passes** — `cargo test mcp::agent_dispatch`, then `cargo test`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/mcp/
git commit -m "feat: tasks_* MCP tools with idempotent upsert"
```

---

### Task 5: HTTP routes for tasks

**Files:** Create `src-tauri/src/server/task_routes.rs`; modify `src-tauri/src/server/mod.rs`.

**Produces:** `GET /api/tasks`, `POST /api/tasks`, `PUT /api/tasks/{id}/done`, `POST /api/tasks/{id}/notes`, `DELETE /api/tasks/{id}`.

- [ ] **Step 1: Write the failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Actor;

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        (AppState::with_token_dir(dir.path()), dir)
    }

    #[tokio::test]
    async fn a_user_created_task_has_no_agent() {
        let (state, _dir) = state();
        let task = create_task_inner(&state, "Buy milk".into(), None).await;
        assert!(task.agent_id.is_none(), "the user's own task belongs to nobody else");
        assert!(task.external_id.is_none());
    }

    #[tokio::test]
    async fn completing_from_the_ui_is_attributed_to_the_user() {
        // The distinction the whole feature rests on: the user's tick must not
        // look like an agent's.
        let (state, _dir) = state();
        let task = create_task_inner(&state, "Thing".into(), None).await;
        assert!(set_done_inner(&state, &task.id, true).await);
        let after = state.tasks.get(&task.id).await.unwrap();
        assert!(matches!(after.completed_by, Some(Actor::User)));
    }

    #[tokio::test]
    async fn a_blank_title_is_refused() {
        let (state, _dir) = state();
        assert!(validate_title("   ").is_none());
        assert_eq!(validate_title("  Real  "), Some("Real".to_string()));
        assert!(state.tasks.list().await.is_empty());
    }
}
```

- [ ] **Step 2: Run to verify it fails** — add `pub mod task_routes;` to `server/mod.rs`; helpers not found.

- [ ] **Step 3: Write the routes**

```rust
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::models::{Actor, Task, WsEvent};
use crate::server::app_state::AppState;

/// Trim and reject blank. Extracted so it is testable without a router.
pub fn validate_title(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// The inner halves exist so the behaviour is testable without spinning up a
/// router — axum extractors are awkward to construct by hand.
pub async fn create_task_inner(
    state: &AppState,
    title: String,
    due: Option<DateTime<Utc>>,
) -> Task {
    let task = state.tasks.create_for_user(title, due).await;
    let _ = state.event_tx.send(WsEvent::TaskUpserted { task: task.clone() });
    task
}

pub async fn set_done_inner(state: &AppState, id: &str, done: bool) -> bool {
    // From the UI, so the actor is always the user. An agent completing
    // something comes through tasks_complete and is labelled differently.
    if !state.tasks.set_done(id, done, Actor::User).await {
        return false;
    }
    if let Some(task) = state.tasks.get(id).await {
        let _ = state.event_tx.send(WsEvent::TaskUpserted { task });
    }
    true
}

pub async fn list_tasks(State(state): State<AppState>) -> Json<Vec<Task>> {
    Json(state.tasks.list().await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub title: String,
    pub due: Option<DateTime<Utc>>,
}

pub async fn create_task(
    State(state): State<AppState>,
    Json(request): Json<CreateTaskRequest>,
) -> Result<(StatusCode, Json<Task>), StatusCode> {
    let Some(title) = validate_title(&request.title) else {
        return Err(StatusCode::BAD_REQUEST);
    };
    let task = create_task_inner(&state, title, request.due).await;
    Ok((StatusCode::CREATED, Json(task)))
}

#[derive(Debug, Deserialize)]
pub struct DoneRequest {
    pub done: bool,
}

pub async fn set_task_done(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<DoneRequest>,
) -> StatusCode {
    if set_done_inner(&state, &id, request.done).await {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

#[derive(Debug, Deserialize)]
pub struct NoteRequest {
    pub body: String,
}

pub async fn add_task_note(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<NoteRequest>,
) -> StatusCode {
    let Some(body) = validate_title(&request.body) else {
        return StatusCode::BAD_REQUEST;
    };
    if !state.tasks.add_note(&id, Actor::User, body).await {
        return StatusCode::NOT_FOUND;
    }
    if let Some(task) = state.tasks.get(&id).await {
        let _ = state.event_tx.send(WsEvent::TaskUpserted { task });
    }
    StatusCode::OK
}

pub async fn delete_task(State(state): State<AppState>, Path(id): Path<String>) -> StatusCode {
    if state.tasks.remove(&id).await {
        let _ = state.event_tx.send(WsEvent::TaskRemoved { task_id: id });
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}
```

Register in `server/mod.rs` with `use task_routes::*;` and:

```rust
        .route("/api/tasks", get(list_tasks))
        .route("/api/tasks", post(create_task))
        .route("/api/tasks/{id}/done", put(set_task_done))
        .route("/api/tasks/{id}/notes", post(add_task_note))
        .route("/api/tasks/{id}", delete(delete_task))
```

- [ ] **Step 4: Run to verify it passes** — `cargo test server::task_routes`, then `cargo test`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/server/
git commit -m "feat: task HTTP routes with user attribution"
```

---

### Task 6: Frontend types, API client and store

**Files:** Modify `src/types/index.ts`, `src/agentApi.ts`, `src/stores/hubStore.ts`. Create `src/stores/hubStore.tasks.test.ts`.

**Produces:** `Task`, `TaskNote`, `Actor` types; `WsEvent` gains `taskUpserted` / `taskRemoved`; `fetchTasks`, `createTask`, `setTaskDone`, `addTaskNote`, `deleteTask`; store gains `tasks: Task[]`, `setTasks`, and handling for both events.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useHubStore } from "./hubStore";
import type { Task } from "../types";

function task(id: string, title: string, done = false): Task {
  return {
    id,
    externalId: null,
    agentId: null,
    title,
    appId: null,
    sourceLabel: null,
    due: null,
    done,
    completedBy: null,
    completedAt: null,
    notes: [],
    createdAt: "2026-08-23T00:00:00Z",
    updatedAt: "2026-08-23T00:00:00Z",
  };
}

describe("hubStore tasks", () => {
  beforeEach(() => useHubStore.setState({ tasks: [] }));

  it("adds a task it has not seen", () => {
    useHubStore.getState().handleWsEvent({ type: "taskUpserted", task: task("t1", "One") });
    expect(useHubStore.getState().tasks).toHaveLength(1);
  });

  it("replaces a task in place rather than duplicating it", () => {
    // The store must mirror the server's upsert semantics, or the list shows
    // the same task twice after an agent re-pushes.
    useHubStore.setState({ tasks: [task("t1", "One")] });
    useHubStore.getState().handleWsEvent({
      type: "taskUpserted",
      task: { ...task("t1", "One renamed"), done: true },
    });

    const tasks = useHubStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("One renamed");
    expect(tasks[0].done).toBe(true);
  });

  it("removes a task", () => {
    useHubStore.setState({ tasks: [task("t1", "One"), task("t2", "Two")] });
    useHubStore.getState().handleWsEvent({ type: "taskRemoved", taskId: "t1" });
    expect(useHubStore.getState().tasks.map((t) => t.id)).toEqual(["t2"]);
  });

  it("ignores a removal for something it does not have", () => {
    useHubStore.setState({ tasks: [task("t1", "One")] });
    useHubStore.getState().handleWsEvent({ type: "taskRemoved", taskId: "ghost" });
    expect(useHubStore.getState().tasks).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — no `tasks` in state.

- [ ] **Step 3: Add the types**

Append to `src/types/index.ts`:

```ts
export type Actor = { kind: "user" } | { kind: "agent"; id: string; name: string };

export interface TaskNote {
  id: string;
  author: Actor;
  body: string;
  createdAt: string;
}

export interface Task {
  id: string;
  /** Stable key from the pushing agent; the server dedupes on it. */
  externalId: string | null;
  /** Null for a task the user typed. */
  agentId: string | null;
  title: string;
  appId: string | null;
  sourceLabel: string | null;
  /** Genuinely optional — an undated task is a real state. */
  due: string | null;
  done: boolean;
  completedBy: Actor | null;
  completedAt: string | null;
  notes: TaskNote[];
  createdAt: string;
  updatedAt: string;
}
```

and to `WsEvent`:

```ts
  | { type: "taskUpserted"; task: Task }
  | { type: "taskRemoved"; taskId: string };
```

- [ ] **Step 4: Add the client**

Append to `src/agentApi.ts`:

```ts
export function fetchTasks(): Promise<Task[]> {
  return getJson<Task[]>("/api/tasks", []);
}

export function createTask(title: string, due?: string): Promise<boolean> {
  return send("/api/tasks", "POST", { title, due: due ?? null });
}

export function setTaskDone(id: string, done: boolean): Promise<boolean> {
  return send(`/api/tasks/${id}/done`, "PUT", { done });
}

export function addTaskNote(id: string, body: string): Promise<boolean> {
  return send(`/api/tasks/${id}/notes`, "POST", { body });
}

export function deleteTask(id: string): Promise<boolean> {
  return send(`/api/tasks/${id}`, "DELETE", {});
}
```

Import `Task` in that file's type import.

- [ ] **Step 5: Extend the store**

Add `tasks: Task[]` and `setTasks` to `HubState`, `tasks: []` to the initial state, `setTasks: (tasks) => set({ tasks })`, and two cases:

```ts
        case "taskUpserted": {
          // Mirrors the server's upsert: replace by id, never append a second.
          const known = state.tasks.some((t) => t.id === event.task.id);
          return {
            tasks: known
              ? state.tasks.map((t) => (t.id === event.task.id ? event.task : t))
              : [...state.tasks, event.task],
          };
        }

        case "taskRemoved":
          return { tasks: state.tasks.filter((t) => t.id !== event.taskId) };
```

- [ ] **Step 6: Run to verify it passes** — `pnpm vitest run src/stores/hubStore.tasks.test.ts`, then `pnpm build`.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/agentApi.ts src/stores/
git commit -m "feat: task types, api client and store state"
```

---

### Task 7: Grouping and date filtering

**Files:** Create `src/feed/groupTasks.ts`, `src/feed/groupTasks.test.ts`.

**Produces:** `type TaskRange = "today" | "week" | "month" | "all"`; `groupTasks(tasks, range, now): TaskGroup[]` where `TaskGroup = { key, label, tasks }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { groupTasks } from "./groupTasks";
import type { Task } from "../types";

const NOW = new Date("2026-08-23T12:00:00Z");

function task(id: string, due: string | null, done = false): Task {
  return {
    id, externalId: null, agentId: null, title: id, appId: null, sourceLabel: null,
    due, done, completedBy: null, completedAt: null, notes: [],
    createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z",
  };
}

const keys = (groups: ReturnType<typeof groupTasks>) => groups.map((g) => g.key);
const idsIn = (groups: ReturnType<typeof groupTasks>, key: string) =>
  groups.find((g) => g.key === key)?.tasks.map((t) => t.id) ?? [];

describe("groupTasks", () => {
  it("separates overdue from today", () => {
    const groups = groupTasks(
      [task("late", "2026-08-22T09:00:00Z"), task("now", "2026-08-23T18:00:00Z")],
      "today",
      NOW
    );
    expect(idsIn(groups, "overdue")).toEqual(["late"]);
    expect(idsIn(groups, "today")).toEqual(["now"]);
  });

  it("always shows undated tasks, whatever the filter", () => {
    // An agent finding "reply to Sarah" has no deadline to read. Hiding it
    // behind a date filter would lose it.
    for (const range of ["today", "week", "month", "all"] as const) {
      const groups = groupTasks([task("undated", null)], range, NOW);
      expect(idsIn(groups, "nodate"), range).toEqual(["undated"]);
    }
  });

  it("always shows overdue, whatever the filter", () => {
    for (const range of ["today", "week", "month", "all"] as const) {
      const groups = groupTasks([task("late", "2026-08-01T09:00:00Z")], range, NOW);
      expect(idsIn(groups, "overdue"), range).toEqual(["late"]);
    }
  });

  it("hides next week's task under the today filter and shows it under week", () => {
    const soon = [task("soon", "2026-08-26T09:00:00Z")];
    expect(keys(groupTasks(soon, "today", NOW))).not.toContain("week");
    expect(idsIn(groupTasks(soon, "week", NOW), "week")).toEqual(["soon"]);
  });

  it("puts a task later this month under month, not week", () => {
    const later = [task("later", "2026-08-31T09:00:00Z")];
    expect(keys(groupTasks(later, "week", NOW))).not.toContain("month");
    expect(idsIn(groupTasks(later, "month", NOW), "month")).toEqual(["later"]);
  });

  it("shows a task beyond this month only under all", () => {
    const far = [task("far", "2026-10-05T09:00:00Z")];
    expect(keys(groupTasks(far, "month", NOW))).not.toContain("later");
    expect(idsIn(groupTasks(far, "all", NOW), "later")).toEqual(["far"]);
  });

  it("keeps done tasks in their own group and out of the dated ones", () => {
    const groups = groupTasks([task("finished", "2026-08-23T09:00:00Z", true)], "today", NOW);
    expect(idsIn(groups, "done")).toEqual(["finished"]);
    expect(idsIn(groups, "today")).toEqual([]);
    expect(idsIn(groups, "overdue")).toEqual([]);
  });

  it("omits empty groups so the pane has no dead headings", () => {
    expect(groupTasks([], "all", NOW)).toEqual([]);
  });

  it("orders dated tasks soonest first and undated by creation", () => {
    const groups = groupTasks(
      [task("b", "2026-08-23T18:00:00Z"), task("a", "2026-08-23T09:00:00Z")],
      "today",
      NOW
    );
    expect(idsIn(groups, "today")).toEqual(["a", "b"]);
  });

  it("tolerates an unparseable due date by treating it as undated", () => {
    const groups = groupTasks([task("broken", "not a date")], "all", NOW);
    expect(idsIn(groups, "nodate")).toEqual(["broken"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — cannot resolve `./groupTasks`.

- [ ] **Step 3: Write the grouper**

```ts
import type { Task } from "../types";

export type TaskRange = "today" | "week" | "month" | "all";

export interface TaskGroup {
  key: "overdue" | "today" | "week" | "month" | "later" | "nodate" | "done";
  label: string;
  tasks: Task[];
}

/** End of the day `date` falls in, in local time. */
function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function endOfMonth(date: Date): Date {
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return endOfDay(end);
}

/** Null for missing or unparseable — a bad date must not become a real deadline. */
function dueDate(task: Task): Date | null {
  if (!task.due) return null;
  const parsed = new Date(task.due);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Group tasks for display, filtered by how far ahead the user is looking.
 *
 * `now` is injected so the tests are not time-dependent.
 *
 * Two groups ignore the filter entirely: **overdue**, because something already
 * late does not become irrelevant when you narrow the view, and **no date**,
 * because a task with no deadline would otherwise be hidden by every filter and
 * lost. Done sits on its own, out of the dated groups.
 */
export function groupTasks(tasks: Task[], range: TaskRange, now: Date): TaskGroup[] {
  const todayEnd = endOfDay(now);
  const weekEnd = endOfDay(addDays(now, 7));
  const monthEnd = endOfMonth(now);

  const buckets: Record<TaskGroup["key"], Task[]> = {
    overdue: [], today: [], week: [], month: [], later: [], nodate: [], done: [],
  };

  for (const task of tasks) {
    if (task.done) {
      buckets.done.push(task);
      continue;
    }
    const due = dueDate(task);
    if (!due) {
      buckets.nodate.push(task);
    } else if (due < now && due < todayEnd) {
      buckets.overdue.push(task);
    } else if (due <= todayEnd) {
      buckets.today.push(task);
    } else if (due <= weekEnd) {
      buckets.week.push(task);
    } else if (due <= monthEnd) {
      buckets.month.push(task);
    } else {
      buckets.later.push(task);
    }
  }

  const bySoonest = (a: Task, b: Task) => (a.due ?? "").localeCompare(b.due ?? "");
  for (const key of Object.keys(buckets) as TaskGroup["key"][]) {
    buckets[key].sort(bySoonest);
  }

  // Which dated horizons the current filter admits. Overdue, no-date and done
  // are always in.
  const horizons: Record<TaskRange, TaskGroup["key"][]> = {
    today: ["today"],
    week: ["today", "week"],
    month: ["today", "week", "month"],
    all: ["today", "week", "month", "later"],
  };
  const allowed = new Set<TaskGroup["key"]>([
    "overdue",
    ...horizons[range],
    "nodate",
    "done",
  ]);

  const labels: Record<TaskGroup["key"], string> = {
    overdue: "Overdue",
    today: "Today",
    week: "This week",
    month: "This month",
    later: "Later",
    nodate: "No date",
    done: "Done",
  };

  const order: TaskGroup["key"][] = [
    "overdue", "today", "week", "month", "later", "nodate", "done",
  ];

  return order
    .filter((key) => allowed.has(key) && buckets[key].length > 0)
    .map((key) => ({ key, label: labels[key], tasks: buckets[key] }));
}
```

- [ ] **Step 4: Run to verify it passes** — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/feed/groupTasks.ts src/feed/groupTasks.test.ts
git commit -m "feat: task grouping and date filtering as a pure function"
```

---

### Task 8: The task row

**Files:** Create `src/components/TaskRow.tsx`, `src/components/TaskRow.test.tsx`.

**Produces:** `TaskRow({ task })` with `data-testid="task-row"`, a `task-checkbox`, a `task-notes-toggle` showing the count, and `task-completed-by` when an agent completed it.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setTaskDone, addTaskNote } = vi.hoisted(() => ({
  setTaskDone: vi.fn(),
  addTaskNote: vi.fn(),
}));
vi.mock("../agentApi", () => ({ setTaskDone, addTaskNote }));

import { TaskRow } from "./TaskRow";
import type { Task } from "../types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1", externalId: null, agentId: null, title: "Send Sarah the breakdown",
    appId: "gmail", sourceLabel: "Re: Q3 invoicing", due: null, done: false,
    completedBy: null, completedAt: null, notes: [],
    createdAt: "2026-08-23T00:00:00Z", updatedAt: "2026-08-23T00:00:00Z",
    ...overrides,
  };
}

describe("TaskRow", () => {
  beforeEach(() => {
    setTaskDone.mockReset().mockResolvedValue(true);
    addTaskNote.mockReset().mockResolvedValue(true);
  });

  it("shows the title and where it came from", () => {
    render(<TaskRow task={task()} />);
    expect(screen.getByText("Send Sarah the breakdown")).toBeInTheDocument();
    // Provenance is load-bearing: without it, a task an agent invented looks
    // the same as one out of a real email.
    expect(screen.getByText("Re: Q3 invoicing")).toBeInTheDocument();
  });

  it("ticks the box", async () => {
    render(<TaskRow task={task()} />);
    await userEvent.click(screen.getByTestId("task-checkbox"));
    expect(setTaskDone).toHaveBeenCalledWith("t1", true);
  });

  it("unticks a done task", async () => {
    render(<TaskRow task={task({ done: true, completedBy: { kind: "user" } })} />);
    await userEvent.click(screen.getByTestId("task-checkbox"));
    expect(setTaskDone).toHaveBeenCalledWith("t1", false);
  });

  it("labels an agent completion with the agent's name", () => {
    render(
      <TaskRow task={task({ done: true, completedBy: { kind: "agent", id: "a1", name: "Ops Agent" } })} />
    );
    expect(screen.getByTestId("task-completed-by")).toHaveTextContent("Ops Agent");
  });

  it("does not label the user's own completion as an agent's", () => {
    render(<TaskRow task={task({ done: true, completedBy: { kind: "user" } })} />);
    expect(screen.queryByTestId("task-completed-by")).toBeNull();
  });

  it("counts notes and keeps them collapsed until asked", async () => {
    const notes = [
      { id: "n1", author: { kind: "user" } as const, body: "waiting on the export", createdAt: "" },
      { id: "n2", author: { kind: "agent", id: "a1", name: "Ops" } as const, body: "export done", createdAt: "" },
    ];
    render(<TaskRow task={task({ notes })} />);

    const toggle = screen.getByTestId("task-notes-toggle");
    expect(toggle).toHaveTextContent("2");
    expect(screen.queryByText("waiting on the export")).toBeNull();

    await userEvent.click(toggle);
    expect(screen.getByText("waiting on the export")).toBeInTheDocument();
    expect(screen.getByText("export done")).toBeInTheDocument();
  });

  it("offers no notes toggle when there are none", () => {
    render(<TaskRow task={task()} />);
    expect(screen.queryByTestId("task-notes-toggle")).toBeNull();
  });

  it("marks an overdue date so it reads as late", () => {
    render(<TaskRow task={task({ due: "2020-01-01T00:00:00Z" })} />);
    expect(screen.getByTestId("task-due")).toHaveAttribute("data-late", "true");
  });

  it("says no date rather than inventing one", () => {
    render(<TaskRow task={task({ due: null })} />);
    expect(screen.getByTestId("task-due")).toHaveTextContent(/no date/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Write the row**

```tsx
import { useState } from "react";
import { setTaskDone } from "../agentApi";
import { AppIcon } from "./AppIcon";
import type { Task } from "../types";

function dueLabel(due: string | null): { text: string; late: boolean } {
  if (!due) return { text: "No date", late: false };
  const date = new Date(due);
  if (Number.isNaN(date.getTime())) return { text: "No date", late: false };

  const now = new Date();
  const late = date.getTime() < now.getTime();
  const sameDay = date.toDateString() === now.toDateString();
  return {
    text: sameDay
      ? "Today"
      : date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    late,
  };
}

export function TaskRow({ task }: { task: Task }) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const due = dueLabel(task.due);
  const agentCompleted = task.completedBy?.kind === "agent" ? task.completedBy : null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    await setTaskDone(task.id, !task.done);
    setBusy(false);
  };

  return (
    <div
      data-testid="task-row"
      data-done={task.done ? "true" : undefined}
      className="flex gap-2 px-2 py-1.5 rounded-lg"
    >
      <button
        type="button"
        data-testid="task-checkbox"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={() => void toggle()}
        className="shrink-0 grid place-items-center mt-0.5"
        style={{
          width: 15,
          height: 15,
          borderRadius: 4.5,
          border: 0,
          cursor: "pointer",
          background: task.done ? "var(--hub-accent)" : "transparent",
          boxShadow: task.done ? "none" : "inset 0 0 0 1px var(--hub-text-dim)",
        }}
      >
        {task.done && (
          <svg width="9" height="9" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 12l5 5L20 6"
              fill="none"
              stroke="var(--hub-accent-text)"
              strokeWidth="3.4"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className="text-[12.5px] leading-snug"
          style={{
            color: task.done ? "var(--hub-text-dim)" : "var(--hub-text)",
            textDecoration: task.done ? "line-through" : undefined,
          }}
        >
          {task.title}
        </div>

        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {task.appId && (
            <span
              className="inline-flex items-center gap-1 text-[9.5px] rounded px-1.5 py-0.5"
              style={{ background: "var(--hub-surface)", color: "var(--hub-text-muted)" }}
            >
              <AppIcon slug={task.appId} size={10} />
              {task.sourceLabel ?? task.appId}
            </span>
          )}

          <span
            data-testid="task-due"
            data-late={due.late && !task.done ? "true" : undefined}
            className="text-[9.5px]"
            style={{
              color: due.late && !task.done ? "#ff7a70" : "var(--hub-text-dim)",
              fontWeight: due.late && !task.done ? 600 : 400,
            }}
          >
            {due.text}
          </span>

          {/* Attribution, not decoration: an agent quietly ticking the user's
              work off would be a trust problem. */}
          {agentCompleted && (
            <span
              data-testid="task-completed-by"
              className="text-[9.5px] rounded px-1.5 py-0.5"
              style={{ background: "rgba(10,132,255,0.16)", color: "#9ecbff" }}
            >
              Completed by {agentCompleted.name}
            </span>
          )}

          {task.notes.length > 0 && (
            <button
              type="button"
              data-testid="task-notes-toggle"
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((open) => !open)}
              className="text-[9.5px] rounded px-1.5 py-0.5"
              style={{
                background: "var(--hub-surface)",
                border: 0,
                color: "var(--hub-text-muted)",
                cursor: "pointer",
              }}
            >
              {notesOpen ? "▾" : "▸"} {task.notes.length} note
              {task.notes.length === 1 ? "" : "s"}
            </button>
          )}
        </div>

        {notesOpen && (
          <div className="flex flex-col gap-1 mt-1.5">
            {task.notes.map((note) => (
              <div
                key={note.id}
                className="text-[11px] leading-snug rounded px-2 py-1.5"
                style={{
                  background: "rgba(0,0,0,0.22)",
                  boxShadow: "inset 0 0 0 1px var(--hub-hair)",
                  color: "var(--hub-text-muted)",
                }}
              >
                <span
                  className="block text-[9px] font-bold uppercase tracking-wide mb-0.5"
                  style={{
                    color:
                      note.author.kind === "agent" ? "#9ecbff" : "var(--hub-text-dim)",
                  }}
                >
                  {note.author.kind === "agent" ? note.author.name : "You"}
                </span>
                {note.body}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/TaskRow.tsx src/components/TaskRow.test.tsx
git commit -m "feat: task row with provenance, notes and completion attribution"
```

---

### Task 9: The Tasks pane

**Files:** Create `src/components/TasksPane.tsx`, `src/components/TasksPane.test.tsx`.

**Produces:** `TasksPane()` with `data-testid="tasks-filter"` (four buttons), group headings, `TaskRow`s, an `task-add-input`, and an open count.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTask, setTaskDone } = vi.hoisted(() => ({
  createTask: vi.fn(),
  setTaskDone: vi.fn(),
}));
vi.mock("../agentApi", () => ({ createTask, setTaskDone, addTaskNote: vi.fn() }));

import { TasksPane } from "./TasksPane";
import { useHubStore } from "../stores/hubStore";
import type { Task } from "../types";

function task(id: string, due: string | null, done = false): Task {
  return {
    id, externalId: null, agentId: null, title: id, appId: null, sourceLabel: null,
    due, done, completedBy: null, completedAt: null, notes: [],
    createdAt: "", updatedAt: "",
  };
}

describe("TasksPane", () => {
  beforeEach(() => {
    createTask.mockReset().mockResolvedValue(true);
    setTaskDone.mockReset().mockResolvedValue(true);
    useHubStore.setState({
      tasks: [
        task("overdue-one", "2020-01-01T00:00:00Z"),
        task("undated", null),
        task("finished", null, true),
      ],
    });
  });

  it("groups tasks under headings", () => {
    render(<TasksPane />);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("No date")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("counts only open tasks", () => {
    render(<TasksPane />);
    expect(screen.getByTestId("tasks-open-count")).toHaveTextContent("2");
  });

  it("keeps undated and overdue visible under the Today filter", async () => {
    render(<TasksPane />);
    await userEvent.click(screen.getByRole("button", { name: /^today$/i }));
    expect(screen.getByText("No date")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("adds a task and clears the field", async () => {
    render(<TasksPane />);
    await userEvent.type(screen.getByTestId("task-add-input"), "Buy milk{Enter}");
    expect(createTask).toHaveBeenCalledWith("Buy milk");
    await waitFor(() => expect(screen.getByTestId("task-add-input")).toHaveValue(""));
  });

  it("will not add a blank task", async () => {
    render(<TasksPane />);
    await userEvent.type(screen.getByTestId("task-add-input"), "   {Enter}");
    expect(createTask).not.toHaveBeenCalled();
  });

  it("says so when there is nothing to do", () => {
    useHubStore.setState({ tasks: [] });
    render(<TasksPane />);
    expect(screen.getByText(/nothing to do/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Write the pane**

```tsx
import { useMemo, useState } from "react";
import { createTask } from "../agentApi";
import { useHubStore } from "../stores/hubStore";
import { groupTasks, type TaskRange } from "../feed/groupTasks";
import { TaskRow } from "./TaskRow";

const RANGES: { id: TaskRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "all", label: "All" },
];

export function TasksPane() {
  const tasks = useHubStore((s) => s.tasks);
  const [range, setRange] = useState<TaskRange>("all");
  const [draft, setDraft] = useState("");

  // Recomputed per render against the current clock — a task that becomes
  // overdue while the pane is open should move on the next update.
  const groups = useMemo(() => groupTasks(tasks, range, new Date()), [tasks, range]);
  const openCount = tasks.filter((t) => !t.done).length;

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    const ok = await createTask(title);
    if (ok) setDraft("");
  };

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-2 px-2 py-2 shrink-0"
        style={{ borderBottom: "1px solid var(--hub-hair)" }}
      >
        <span
          data-testid="tasks-open-count"
          className="text-[11px] shrink-0"
          style={{ color: "var(--hub-text-muted)" }}
        >
          {openCount} open
        </span>
        <span
          data-testid="tasks-filter"
          className="flex items-center gap-0.5 ml-auto rounded-md p-0.5"
          style={{ background: "rgba(0,0,0,0.24)" }}
        >
          {RANGES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={range === option.id}
              onClick={() => setRange(option.id)}
              className="text-[10.5px] rounded px-1.5 py-0.5"
              style={{
                border: 0,
                cursor: "pointer",
                fontWeight: range === option.id ? 600 : 500,
                background: range === option.id ? "var(--hub-surface)" : "transparent",
                color: range === option.id ? "var(--hub-text)" : "var(--hub-text-muted)",
              }}
            >
              {option.label}
            </button>
          ))}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5">
        {groups.length === 0 && (
          <span className="text-[11px] px-2 py-3" style={{ color: "var(--hub-text-muted)" }}>
            Nothing to do. Agents add tasks here from the apps they are connected to.
          </span>
        )}

        {groups.map((group) => (
          <div key={group.key}>
            <div
              className="text-[9px] font-semibold uppercase tracking-wide px-2 pt-2 pb-0.5"
              style={{ color: "var(--hub-text-dim)" }}
            >
              {group.label}
            </div>
            {group.tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        ))}
      </div>

      <div
        className="shrink-0 flex items-center gap-1.5 px-2 py-2"
        style={{ borderTop: "1px solid var(--hub-hair)" }}
      >
        <span
          aria-hidden="true"
          className="grid place-items-center text-[11px] shrink-0"
          style={{
            width: 15,
            height: 15,
            borderRadius: 4.5,
            boxShadow: "inset 0 0 0 1px var(--hub-text-dim)",
            color: "var(--hub-text-dim)",
          }}
        >
          +
        </span>
        <input
          data-testid="task-add-input"
          value={draft}
          placeholder="Add a task&hellip;"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          className="flex-1 min-w-0 text-[11.5px] rounded-md px-2 py-1"
          style={{
            background: "rgba(0,0,0,0.24)",
            border: 0,
            boxShadow: "inset 0 0 0 1px var(--hub-hair)",
            color: "var(--hub-text)",
            outline: "none",
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/TasksPane.tsx src/components/TasksPane.test.tsx
git commit -m "feat: tasks pane with date filters and inline add"
```

---

### Task 10: Wire Tasks into the rail

**Files:** Modify `src/hooks/useAgentData.ts`, `src/Rail.tsx`, `src/components/RailNub.tsx`, `src/components/RailNub.test.tsx`.

- [ ] **Step 1: Write the failing test**

Append to `RailNub.test.tsx`:

```tsx
  it("shows the open task count on the nub", () => {
    // The spec's third resting variant: two numbers worth showing, unread
    // activity and open tasks, still inside 32px.
    useHubStore.setState({
      sessions: [],
      unreadSessions: new Set(),
      agentPosts: [],
      tasks: [
        { id: "t1", externalId: null, agentId: null, title: "a", appId: null, sourceLabel: null, due: null, done: false, completedBy: null, completedAt: null, notes: [], createdAt: "", updatedAt: "" },
        { id: "t2", externalId: null, agentId: null, title: "b", appId: null, sourceLabel: null, due: null, done: true, completedBy: null, completedAt: null, notes: [], createdAt: "", updatedAt: "" },
      ],
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("nub-task-count")).toHaveTextContent("1");
  });

  it("hides the task count when nothing is open", () => {
    useHubStore.setState({ sessions: [], unreadSessions: new Set(), agentPosts: [], tasks: [] });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.queryByTestId("nub-task-count")).toBeNull();
  });
```

Also add `tasks: []` to that file's `beforeEach`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Add the count to the nub**

Read `tasks` from the store, compute `openTasks = tasks.filter((t) => !t.done).length`, include it in the `isIdle` check, and render below the agent marker:

```tsx
      {openTasks > 0 && (
        <span
          data-testid="nub-task-count"
          className="flex flex-col items-center"
          style={{ color: "var(--hub-text-muted)", fontSize: 9.5, lineHeight: 1.1 }}
        >
          <span aria-hidden="true">✓</span>
          <span className="font-bold tabular-nums" style={{ color: "#eab308" }}>
            {openTasks}
          </span>
        </span>
      )}
```

- [ ] **Step 4: Load tasks and add the pane**

In `useAgentData.ts`, add `fetchTasks()` to the `Promise.all` and `setTasks(tasks)`.

In `Rail.tsx`, widen the pane union to `"feed" | "tasks" | "agents"`, add a `Tasks` button to the switch, and render `<TasksPane />` for it.

- [ ] **Step 5: Run the whole suite** — `pnpm vitest run`, then `pnpm build`, then `cd src-tauri; cargo test`.

- [ ] **Step 6: Verify against a live agent**

With Hive on 9456 and the rail open, push a task and confirm on screen:

```bash
# after initialize + agent_apps_sync from src-tauri/tests/agent_ingest.md
tasks_upsert {"external_id":"gmail:thread-1","title":"Send Sarah the Q3 rates breakdown","app_id":"gmail","source_label":"Re: Q3 invoicing","due":"2026-08-22T09:00:00Z"}
tasks_upsert {"external_id":"gmail:thread-1","title":"Send Sarah the Q3 rates breakdown"}   # must NOT duplicate
tasks_note   {"task_id":"<id>","body":"Xero export finished at 10:58"}
tasks_complete {"task_id":"<id>"}
```

Check: one task not two; the Gmail chip with its source label; the overdue date in red; a `1 note` toggle that expands; and `Completed by Grok` after the complete call. Then restart Hive and confirm the task is still there.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useAgentData.ts src/Rail.tsx src/components/RailNub.tsx src/components/RailNub.test.tsx
git commit -m "feat: tasks pane in the rail and open count on the nub"
```

---

## Self-review

**Spec coverage.** Checkable rows → Task 8. Provenance chip → Task 8, with the icon from phase 3b. Date filter → Task 7 and 9. No-date group visible in every filter → Task 7, asserted for all four ranges. Collapsible notes with a count → Task 8. Agent completions labelled → Tasks 2, 4 and 8, attributed at the store, over MCP, and in the row. Idempotency → Task 2, tested first, plus the over-the-wire test in Task 4. Disk persistence → Task 2, write-through with a restart test. Task count on the nub → Task 10, which is the spec's third resting variant.

**Deliberately not built:** editing a task's title or due date by hand (not in the spec); a per-task delete button (the route exists, no UI — the spec never asked for one, and a destructive control needs a confirm flow that has not been designed).

**Type consistency.** `Actor` is one tagged union in Rust and TypeScript, with matching `kind` values. `Task.due` is `Option<DateTime<Utc>>` / `string | null`, and both sides treat an unparseable value as *no date* rather than now — asserted in Task 4 and Task 7. `groupTasks(tasks, range, now)` takes `now` by injection so no test depends on the clock. `TaskGroup["key"]` drives the buckets, labels and ordering from one union, so adding a group cannot half-land.

**One risk worth naming.** `persist()` rewrites the whole file inside the write lock on every mutation. Correct and simple at a few dozen tasks; if the list ever grows into the thousands it should move to a debounced background write.
