use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Running,
    WaitingForInput,
    Thinking,
    Error,
    Idle,
}

impl Default for SessionStatus {
    fn default() -> Self {
        SessionStatus::Idle
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project_name: String,
    pub custom_name: Option<String>,
    pub working_directory: String,
    pub git_branch: Option<String>,
    pub status: SessionStatus,
    pub status_detail: Option<String>,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub window_handle: Option<u64>,
    /// Claude Code's own session id, reported by a hook. The transcript that
    /// carries this session's token usage is named after it, which is what
    /// lets the dashboard attribute usage exactly rather than by directory.
    pub claude_session_id: Option<String>,
}

impl Session {
    pub fn display_name(&self) -> &str {
        self.custom_name.as_deref().unwrap_or(&self.project_name)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterSessionRequest {
    pub id: Option<String>,
    pub working_directory: String,
    pub git_branch: Option<String>,
    pub window_handle: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusRequest {
    pub status: SessionStatus,
    pub detail: Option<String>,
    #[serde(default)]
    pub silent: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameSessionRequest {
    pub name: String,
}
