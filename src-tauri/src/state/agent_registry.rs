use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;

use crate::models::{Agent, AgentApp};

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AppHealth;

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
    async fn touch_advances_last_seen_only() {
        let reg = AgentRegistry::new();
        let created = reg.upsert("a1", "Grok".into(), None).await;
        reg.touch("a1").await;
        let after = reg.get("a1").await.unwrap();
        assert!(after.last_seen >= created.last_seen);
        assert_eq!(after.connected_at, created.connected_at);
    }
}
