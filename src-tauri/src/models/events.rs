use serde::Serialize;
use super::{Session, SessionStatus, Message, NotifyPriority, Question};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WsEvent {
    #[serde(rename_all = "camelCase")]
    SessionConnected { session: Session },
    #[serde(rename_all = "camelCase")]
    SessionDisconnected { session_id: String },
    #[serde(rename_all = "camelCase")]
    StatusChanged { session_id: String, status: SessionStatus, detail: Option<String> },
    #[serde(rename_all = "camelCase")]
    NewMessage { message: Message },
    #[serde(rename_all = "camelCase")]
    Notification { session_id: String, title: String, body: String, priority: NotifyPriority },
    #[serde(rename_all = "camelCase")]
    QuestionAsked { question: Question },
    #[serde(rename_all = "camelCase")]
    QuestionAnswered { session_id: String, question_id: String, answer: Vec<String> },
}
