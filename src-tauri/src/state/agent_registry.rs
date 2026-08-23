use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::models::{Agent, AgentApp, AppHealth};

const FILE_NAME: &str = "agents.json";

/// What is written to disk. A snapshot, not an event log.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Persisted {
    agents: Vec<Agent>,
    apps: HashMap<String, Vec<AgentApp>>,
}

/// Agents and the apps they have declared. Mirrors `SessionRegistry`'s shape so
/// the two read the same way; kept separate because an agent has no working
/// directory, terminal handle, or user-driven status.
///
/// Persisted, unlike sessions. A session is alive or it is not — a dead one has
/// nothing to show. An agent's declared apps are a standing fact, and losing
/// them on restart left the connector bar empty until every agent happened to
/// call in again, which reads as "nothing is connected" rather than "nobody has
/// checked in yet". `enabled` has to survive for the same reason: muting an
/// agent should not quietly undo itself.
#[derive(Debug, Clone)]
pub struct AgentRegistry {
    agents: Arc<RwLock<HashMap<String, Agent>>>,
    apps: Arc<RwLock<HashMap<String, Vec<AgentApp>>>>,
    /// None for the in-memory registry the tests use.
    path: Option<Arc<PathBuf>>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self {
            agents: Arc::new(RwLock::new(HashMap::new())),
            apps: Arc::new(RwLock::new(HashMap::new())),
            path: None,
        }
    }

    /// Load what the last run declared, or start empty.
    pub fn load_or_create(dir: &Path) -> Self {
        let path = dir.join(FILE_NAME);
        let loaded: Persisted = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            // Unreadable or corrupt: start empty rather than refuse to boot.
            .unwrap_or_default();

        let agents = loaded
            .agents
            .into_iter()
            .map(|a| (a.id.clone(), a))
            .collect();
        // Nothing has reported in yet this run, so no app's health is known.
        let apps = loaded
            .apps
            .into_iter()
            .map(|(agent_id, apps)| {
                let apps = apps
                    .into_iter()
                    .map(|app| AgentApp { health: AppHealth::Unknown, ..app })
                    .collect();
                (agent_id, apps)
            })
            .collect();

        Self {
            agents: Arc::new(RwLock::new(agents)),
            apps: Arc::new(RwLock::new(apps)),
            path: Some(Arc::new(path)),
        }
    }

    /// Write the whole snapshot. Called after every mutation but `touch`.
    ///
    /// `touch` is deliberately excluded: it fires on every single tool call, and
    /// a disk write per call to keep `lastSeen` to the second is not a trade
    /// worth making. The value on disk is from the agent's last handshake.
    async fn persist(&self) {
        let Some(path) = self.path.as_ref() else {
            return;
        };

        let snapshot = Persisted {
            agents: self.agents.read().await.values().cloned().collect(),
            apps: self.apps.read().await.clone(),
        };
        let json = match serde_json::to_string_pretty(&snapshot) {
            Ok(json) => json,
            Err(e) => {
                tracing::error!("agents: could not serialise: {e}");
                return;
            }
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(path.as_path(), json) {
            // Losing the write is bad; taking the dashboard down with it is
            // worse. The in-memory registry stays correct for this session.
            tracing::error!("agents: could not write {}: {e}", path.display());
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
            })
            .clone();
        drop(agents);
        self.persist().await;
        agent
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
        let found = match self.agents.write().await.get_mut(id) {
            Some(agent) => {
                agent.enabled = enabled;
                true
            }
            None => false,
        };
        if found {
            self.persist().await;
        }
        found
    }

    /// Replace the agent's app list wholesale. Replacing rather than merging is
    /// the whole point: an app the agent no longer reports has disconnected and
    /// must leave the bar, and a merge could never express that.
    pub async fn sync_apps(&self, id: &str, apps: Vec<AgentApp>) {
        self.apps.write().await.insert(id.to_string(), apps);
        self.persist().await;
    }

    pub async fn apps(&self, id: &str) -> Vec<AgentApp> {
        self.apps.read().await.get(id).cloned().unwrap_or_default()
    }

    /// Add `app_id` if the agent has not declared it. Returns whether it added.
    ///
    /// The safety net for an agent that posts without calling
    /// `agent_apps_sync`: without this, a post is attributed to an app that
    /// appears nowhere in the bar, so the user can neither filter to it nor
    /// mute it. The label can only be the slug — nothing better was sent.
    ///
    /// `sync_apps` stays authoritative and can remove what this added.
    pub async fn ensure_app(&self, agent_id: &str, app_id: &str) -> bool {
        let mut apps = self.apps.write().await;
        let entry = apps.entry(agent_id.to_string()).or_default();
        if entry.iter().any(|a| a.id == app_id) {
            return false;
        }
        entry.push(AgentApp {
            id: app_id.to_string(),
            label: app_id.to_string(),
            health: AppHealth::Ok,
        });
        drop(apps);
        self.persist().await;
        true
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
        assert!(!reg.get("a1").await.unwrap().enabled);
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
        assert_eq!(all[0].0, "a2");
        assert_eq!(all[0].1.id, "gmail");
        assert_eq!(all[1].0, "a1");
    }

    #[tokio::test]
    async fn two_agents_may_both_expose_the_same_app() {
        // The bar must be able to show Gmail twice, once per agent, rather than
        // collapsing them and losing which agent to reply to.
        let reg = AgentRegistry::new();
        reg.sync_apps("a1", vec![app("gmail", "Gmail")]).await;
        reg.sync_apps("a2", vec![app("gmail", "Gmail")]).await;
        assert_eq!(reg.all_apps().await.len(), 2);
    }

    #[tokio::test]
    async fn ensure_app_adds_an_undeclared_app_once() {
        let reg = AgentRegistry::new();
        assert!(reg.ensure_app("a1", "gmail").await, "first sighting adds it");
        assert!(!reg.ensure_app("a1", "gmail").await, "second is a no-op");
        assert_eq!(reg.apps("a1").await.len(), 1);
    }

    #[tokio::test]
    async fn ensure_app_labels_it_from_the_slug() {
        // Nothing better is available: the agent never declared a label.
        let reg = AgentRegistry::new();
        reg.ensure_app("a1", "made-up-thing").await;
        assert_eq!(reg.apps("a1").await[0].label, "made-up-thing");
    }

    #[tokio::test]
    async fn a_later_sync_can_still_replace_an_auto_added_app() {
        let reg = AgentRegistry::new();
        reg.ensure_app("a1", "gmail").await;
        reg.sync_apps("a1", vec![]).await;
        assert!(reg.apps("a1").await.is_empty(), "sync stays authoritative");
    }

    #[tokio::test]
    async fn ensure_app_does_not_disturb_a_declared_app() {
        let reg = AgentRegistry::new();
        reg.sync_apps("a1", vec![AgentApp {
            id: "gmail".into(),
            label: "Gmail".into(),
            health: AppHealth::Degraded,
        }])
        .await;
        assert!(!reg.ensure_app("a1", "gmail").await);
        assert_eq!(reg.apps("a1").await[0].label, "Gmail", "the declared label survives");
        assert_eq!(reg.apps("a1").await[0].health, AppHealth::Degraded);
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

    #[tokio::test]
    async fn declared_apps_survive_a_restart() {
        // The bar was empty after every restart until each agent happened to
        // call in again, which reads as "nothing is connected".
        let dir = tempfile::tempdir().unwrap();
        {
            let reg = AgentRegistry::load_or_create(dir.path());
            reg.upsert("a1", "Grok Bot".into(), Some("1.0".into())).await;
            reg.sync_apps("a1", vec![app("gmail", "Gmail"), app("linear", "Linear")]).await;
        }

        let reopened = AgentRegistry::load_or_create(dir.path());
        let agents = reopened.list().await;
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].name, "Grok Bot");

        let apps = reopened.apps("a1").await;
        assert_eq!(apps.len(), 2, "declared apps come back");
        assert_eq!(apps[0].label, "Gmail");
    }

    #[tokio::test]
    async fn restored_apps_report_unknown_health_until_the_agent_checks_in() {
        // The last health we saw is not news. Showing it as live would be a
        // claim Hive cannot make about an agent that has not spoken yet.
        let dir = tempfile::tempdir().unwrap();
        {
            let reg = AgentRegistry::load_or_create(dir.path());
            reg.sync_apps(
                "a1",
                vec![AgentApp {
                    id: "gmail".into(),
                    label: "Gmail".into(),
                    health: AppHealth::Down,
                }],
            )
            .await;
        }

        let reopened = AgentRegistry::load_or_create(dir.path());
        assert_eq!(reopened.apps("a1").await[0].health, AppHealth::Unknown);

        // And a fresh sync replaces it with what the agent actually reports.
        reopened.sync_apps("a1", vec![app("gmail", "Gmail")]).await;
        assert_eq!(reopened.apps("a1").await[0].health, AppHealth::Ok);
    }

    #[tokio::test]
    async fn muting_an_agent_survives_a_restart() {
        // Otherwise the mute quietly undoes itself and the agent starts posting
        // again on its own.
        let dir = tempfile::tempdir().unwrap();
        {
            let reg = AgentRegistry::load_or_create(dir.path());
            reg.upsert("a1", "Grok".into(), None).await;
            reg.set_enabled("a1", false).await;
        }

        let reopened = AgentRegistry::load_or_create(dir.path());
        assert!(!reopened.get("a1").await.unwrap().enabled);
    }

    #[tokio::test]
    async fn a_corrupt_file_starts_empty_rather_than_refusing_to_boot() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("agents.json"), "{not json").unwrap();
        let reg = AgentRegistry::load_or_create(dir.path());
        assert!(reg.list().await.is_empty());
    }

    #[tokio::test]
    async fn an_auto_added_app_is_persisted_too() {
        // ensure_app is the safety net for an agent that posts without syncing;
        // if it were not written, the app would vanish on the next restart and
        // the post would again be unfilterable.
        let dir = tempfile::tempdir().unwrap();
        {
            let reg = AgentRegistry::load_or_create(dir.path());
            reg.ensure_app("a1", "made-up-thing").await;
        }
        let reopened = AgentRegistry::load_or_create(dir.path());
        assert_eq!(reopened.apps("a1").await.len(), 1);
    }
}
