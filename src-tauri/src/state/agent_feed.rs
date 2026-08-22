use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;
use uuid::Uuid;

use crate::models::{AgentPost, AgentReply, MessageType};

/// How many posts to keep in memory. Posts are not persisted in this phase, so
/// this only bounds growth in a dashboard left open for days.
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

        // Draining is destructive: an agent that polls twice must not act on
        // the same instruction twice.
        assert_eq!(feed.drain_replies("a1").await.len(), 0);
        assert_eq!(feed.pending_reply_count("a1").await, 0);
    }

    #[tokio::test]
    async fn replies_are_kept_per_agent() {
        let feed = AgentFeed::new();
        feed.enqueue_reply("a1", "for grok".into()).await;
        feed.enqueue_reply("a2", "for ops".into()).await;

        assert_eq!(feed.drain_replies("a1").await.len(), 1);
        assert_eq!(
            feed.pending_reply_count("a2").await,
            1,
            "draining one agent must not touch another"
        );
    }

    #[tokio::test]
    async fn draining_an_unknown_agent_is_empty_not_a_panic() {
        let feed = AgentFeed::new();
        assert_eq!(feed.drain_replies("nobody").await.len(), 0);
    }

    #[tokio::test]
    async fn the_post_buffer_is_bounded() {
        let feed = AgentFeed::new();
        for i in 0..(MAX_POSTS + 50) {
            feed.post("a1", "Grok", None, format!("p{i}"), MessageType::Info).await;
        }
        // Unbounded growth in a dashboard left open for days is a leak; the
        // oldest posts are dropped, and the newest must survive.
        let all = feed.recent(MAX_POSTS + 100).await;
        assert_eq!(all.len(), MAX_POSTS);
        assert_eq!(all[0].content, format!("p{}", MAX_POSTS + 49));
    }
}
