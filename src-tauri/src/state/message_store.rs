use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::models::{Message, MessageFrom, MessageType};

#[derive(Debug, Clone)]
pub struct MessageStore {
    messages: Arc<RwLock<HashMap<String, Vec<Message>>>>,
}

impl MessageStore {
    pub fn new() -> Self {
        Self {
            messages: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn add_message(
        &self,
        session_id: &str,
        from: MessageFrom,
        from_session_name: Option<String>,
        content: String,
        message_type: MessageType,
    ) -> Message {
        let message = Message {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            from,
            from_session_name,
            content,
            message_type,
            timestamp: Utc::now(),
            read: false,
        };

        let mut store = self.messages.write().await;
        store
            .entry(session_id.to_string())
            .or_default()
            .push(message.clone());
        message
    }

    pub async fn get_messages(
        &self,
        session_id: &str,
        since: Option<DateTime<Utc>>,
        unread_only: bool,
    ) -> Vec<Message> {
        let store = self.messages.read().await;
        let Some(messages) = store.get(session_id) else {
            return vec![];
        };

        messages
            .iter()
            .filter(|m| {
                if let Some(since) = since {
                    if m.timestamp <= since {
                        return false;
                    }
                }
                if unread_only && m.read {
                    return false;
                }
                true
            })
            .cloned()
            .collect()
    }

    pub async fn mark_read(&self, session_id: &str, message_ids: &[String]) {
        let mut store = self.messages.write().await;
        if let Some(messages) = store.get_mut(session_id) {
            for msg in messages.iter_mut() {
                if message_ids.contains(&msg.id) {
                    msg.read = true;
                }
            }
        }
    }

    pub async fn get_latest_message(&self, session_id: &str) -> Option<Message> {
        let store = self.messages.read().await;
        store.get(session_id).and_then(|msgs| msgs.last().cloned())
    }

    pub async fn get_all_messages(&self, session_id: &str) -> Vec<Message> {
        let store = self.messages.read().await;
        store.get(session_id).cloned().unwrap_or_default()
    }

    pub async fn clear_messages(&self, session_id: &str) {
        let mut store = self.messages.write().await;
        if let Some(messages) = store.get_mut(session_id) {
            messages.clear();
        }
    }

    pub async fn remove_session(&self, session_id: &str) {
        self.messages.write().await.remove(session_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn add_message_stores_and_returns_message() {
        let store = MessageStore::new();
        let msg = store
            .add_message("s1", MessageFrom::Session, None, "hello".to_string(), MessageType::Info)
            .await;

        assert_eq!(msg.session_id, "s1");
        assert_eq!(msg.content, "hello");
        assert!(!msg.read);
    }

    #[tokio::test]
    async fn get_messages_filters_by_unread() {
        let store = MessageStore::new();
        let msg1 = store
            .add_message("s1", MessageFrom::Session, None, "first".to_string(), MessageType::Info)
            .await;
        store
            .add_message("s1", MessageFrom::User, None, "second".to_string(), MessageType::Info)
            .await;

        store.mark_read("s1", &[msg1.id.clone()]).await;

        let unread = store.get_messages("s1", None, true).await;
        assert_eq!(unread.len(), 1);
        assert_eq!(unread[0].content, "second");
    }

    #[tokio::test]
    async fn get_messages_filters_by_since() {
        let store = MessageStore::new();
        let msg1 = store
            .add_message("s1", MessageFrom::Session, None, "old".to_string(), MessageType::Info)
            .await;
        let after = msg1.timestamp;

        tokio::time::sleep(std::time::Duration::from_millis(10)).await;

        store
            .add_message("s1", MessageFrom::User, None, "new".to_string(), MessageType::Info)
            .await;

        let messages = store.get_messages("s1", Some(after), false).await;
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "new");
    }

    #[tokio::test]
    async fn get_latest_message_returns_last() {
        let store = MessageStore::new();
        store
            .add_message("s1", MessageFrom::Session, None, "first".to_string(), MessageType::Info)
            .await;
        store
            .add_message("s1", MessageFrom::Session, None, "second".to_string(), MessageType::Info)
            .await;

        let latest = store.get_latest_message("s1").await;
        assert_eq!(latest.unwrap().content, "second");
    }

    #[tokio::test]
    async fn get_messages_returns_empty_for_unknown_session() {
        let store = MessageStore::new();
        let messages = store.get_messages("nonexistent", None, false).await;
        assert!(messages.is_empty());
    }

    #[tokio::test]
    async fn remove_session_clears_messages() {
        let store = MessageStore::new();
        store
            .add_message("s1", MessageFrom::Session, None, "hello".to_string(), MessageType::Info)
            .await;
        store.remove_session("s1").await;
        assert!(store.get_all_messages("s1").await.is_empty());
    }
}
