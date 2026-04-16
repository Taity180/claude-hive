use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;
use uuid::Uuid;

use crate::models::{Session, SessionStatus, RegisterSessionRequest, UpdateStatusRequest};

#[derive(Debug, Clone)]
pub struct SessionRegistry {
    sessions: Arc<RwLock<HashMap<String, Session>>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register(&self, request: RegisterSessionRequest) -> Session {
        let id = request.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let project_name = request
            .working_directory
            .split(['/', '\\'])
            .filter(|s| !s.is_empty())
            .last()
            .unwrap_or("unknown")
            .to_string();
        let now = Utc::now();

        let session = Session {
            id: id.clone(),
            project_name,
            custom_name: None,
            working_directory: request.working_directory,
            git_branch: request.git_branch,
            status: SessionStatus::default(),
            status_detail: None,
            connected_at: now,
            last_activity: now,
            window_handle: request.window_handle,
        };

        self.sessions.write().await.insert(id, session.clone());
        session
    }

    pub async fn unregister(&self, session_id: &str) -> Option<Session> {
        self.sessions.write().await.remove(session_id)
    }

    pub async fn get(&self, session_id: &str) -> Option<Session> {
        self.sessions.read().await.get(session_id).cloned()
    }

    pub async fn list(&self) -> Vec<Session> {
        self.sessions.read().await.values().cloned().collect()
    }

    pub async fn update_status(&self, session_id: &str, request: UpdateStatusRequest) -> Option<Session> {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(session_id) {
            session.status = request.status;
            session.status_detail = request.detail;
            session.last_activity = Utc::now();
            Some(session.clone())
        } else {
            None
        }
    }

    pub async fn rename(&self, session_id: &str, name: String) -> Option<Session> {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(session_id) {
            session.custom_name = if name.is_empty() { None } else { Some(name) };
            Some(session.clone())
        } else {
            None
        }
    }

    pub async fn heartbeat(&self, session_id: &str) -> bool {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(session_id) {
            session.last_activity = Utc::now();
            true
        } else {
            false
        }
    }

    /// Remove sessions that haven't had activity in the given duration.
    /// Returns the IDs of pruned sessions.
    pub async fn prune_stale(&self, max_age: chrono::Duration) -> Vec<String> {
        let cutoff = Utc::now() - max_age;
        let mut sessions = self.sessions.write().await;
        let stale: Vec<String> = sessions
            .iter()
            .filter(|(_, s)| s.last_activity < cutoff)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &stale {
            sessions.remove(id);
        }
        stale
    }

    pub async fn count(&self) -> usize {
        self.sessions.read().await.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn register_creates_session_with_project_name_from_path() {
        let registry = SessionRegistry::new();
        let session = registry
            .register(RegisterSessionRequest {
                id: None,
                working_directory: "/home/user/projects/my-app".to_string(),
                git_branch: Some("main".to_string()),
                window_handle: None,
            })
            .await;

        assert_eq!(session.project_name, "my-app");
        assert_eq!(session.status, SessionStatus::Idle);
        assert_eq!(session.git_branch, Some("main".to_string()));
        assert!(!session.id.is_empty());
    }

    #[tokio::test]
    async fn register_handles_windows_paths() {
        let registry = SessionRegistry::new();
        let session = registry
            .register(RegisterSessionRequest {
                id: None,
                working_directory: "C:\\Users\\dev\\projects\\MyApp".to_string(),
                git_branch: None,
                window_handle: None,
            })
            .await;

        assert_eq!(session.project_name, "MyApp");
    }

    #[tokio::test]
    async fn unregister_removes_and_returns_session() {
        let registry = SessionRegistry::new();
        let session = registry
            .register(RegisterSessionRequest {
                id: None,
                working_directory: "/tmp/test".to_string(),
                git_branch: None,
                window_handle: None,
            })
            .await;

        let removed = registry.unregister(&session.id).await;
        assert!(removed.is_some());
        assert_eq!(registry.count().await, 0);
    }

    #[tokio::test]
    async fn unregister_returns_none_for_unknown_id() {
        let registry = SessionRegistry::new();
        assert!(registry.unregister("nonexistent").await.is_none());
    }

    #[tokio::test]
    async fn update_status_changes_session_status() {
        let registry = SessionRegistry::new();
        let session = registry
            .register(RegisterSessionRequest {
                id: None,
                working_directory: "/tmp/test".to_string(),
                git_branch: None,
                window_handle: None,
            })
            .await;

        let updated = registry
            .update_status(
                &session.id,
                UpdateStatusRequest {
                    status: SessionStatus::WaitingForInput,
                    detail: Some("Need user confirmation".to_string()),
                    silent: false,
                },
            )
            .await;

        assert!(updated.is_some());
        let updated = updated.unwrap();
        assert_eq!(updated.status, SessionStatus::WaitingForInput);
        assert_eq!(updated.status_detail, Some("Need user confirmation".to_string()));
    }

    #[tokio::test]
    async fn list_returns_all_sessions() {
        let registry = SessionRegistry::new();
        registry
            .register(RegisterSessionRequest {
                id: None,
                working_directory: "/tmp/a".to_string(),
                git_branch: None,
                window_handle: None,
            })
            .await;
        registry
            .register(RegisterSessionRequest {
                id: None,
                working_directory: "/tmp/b".to_string(),
                git_branch: None,
                window_handle: None,
            })
            .await;

        assert_eq!(registry.list().await.len(), 2);
    }

    #[tokio::test]
    async fn register_with_specific_id_uses_that_id() {
        let registry = SessionRegistry::new();
        let session = registry
            .register(RegisterSessionRequest {
                id: Some("my-custom-id".to_string()),
                working_directory: "/tmp/test".to_string(),
                git_branch: None,
                window_handle: None,
            })
            .await;

        assert_eq!(session.id, "my-custom-id");
        assert!(registry.get("my-custom-id").await.is_some());
    }

    #[tokio::test]
    async fn re_register_replaces_existing_session() {
        let registry = SessionRegistry::new();
        registry
            .register(RegisterSessionRequest {
                id: Some("session-1".to_string()),
                working_directory: "/tmp/v1".to_string(),
                git_branch: Some("main".to_string()),
                window_handle: None,
            })
            .await;

        // Re-register same ID with different data
        let session = registry
            .register(RegisterSessionRequest {
                id: Some("session-1".to_string()),
                working_directory: "/tmp/v2".to_string(),
                git_branch: Some("develop".to_string()),
                window_handle: None,
            })
            .await;

        assert_eq!(session.id, "session-1");
        assert_eq!(session.working_directory, "/tmp/v2");
        assert_eq!(registry.count().await, 1);
    }
}
