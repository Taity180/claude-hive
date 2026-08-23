use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use crate::models::WsEvent;
use crate::state::{
    AgentFeed, AgentRegistry, AgentTokens, MessageStore, PlanUsageClient, QuestionStore,
    SessionRegistry, TaskStore, UsageScanner,
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
    pub tasks: TaskStore,
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
            agents: AgentRegistry::load_or_create(dir),
            agent_feed: AgentFeed::new(),
            tasks: TaskStore::load_or_create(dir),
            agent_tokens: Arc::new(RwLock::new(tokens)),
            event_tx,
        }
    }
}

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
    async fn a_fresh_state_has_an_empty_task_list() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::with_token_dir(dir.path());
        assert!(state.tasks.list().await.is_empty());
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
