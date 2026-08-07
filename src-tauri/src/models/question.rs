use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Largest number of options a question may offer. Past this the dashboard
/// stops being a quick pick and starts being a form, which is what the reply
/// box is for.
pub const MAX_OPTIONS: usize = 8;

/// A multiple-choice question a session has put to the user, and the answer
/// once one comes back.
///
/// Unlike a chat message, a question is a request the session is *blocked on*:
/// `hub_ask` holds its tool call open until `answer` is filled in or it times
/// out. Only one question is pending per session — asking again replaces it,
/// on the grounds that a session that moved on has abandoned the old one.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: String,
    pub session_id: String,
    pub question: String,
    pub options: Vec<String>,
    pub multi_select: bool,
    pub asked_at: DateTime<Utc>,
    pub answer: Option<Vec<String>>,
    pub answered_at: Option<DateTime<Utc>>,
}

impl Question {
    pub fn is_pending(&self) -> bool {
        self.answer.is_none()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskRequest {
    pub question: String,
    pub options: Vec<String>,
    #[serde(default)]
    pub multi_select: bool,
}

impl AskRequest {
    /// Returns the reason this request is unusable, if it is.
    pub fn validation_error(&self) -> Option<String> {
        if self.question.trim().is_empty() {
            return Some("question must not be empty".to_string());
        }
        if self.options.len() < 2 {
            return Some("at least 2 options are required".to_string());
        }
        if self.options.len() > MAX_OPTIONS {
            return Some(format!("at most {} options are allowed", MAX_OPTIONS));
        }
        if self.options.iter().any(|o| o.trim().is_empty()) {
            return Some("options must not be empty".to_string());
        }
        None
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerRequest {
    pub question_id: String,
    pub answer: Vec<String>,
}
