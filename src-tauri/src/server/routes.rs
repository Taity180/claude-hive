use axum::{
    extract::State,
    extract::Path,
    http::StatusCode,
    Json,
};

use crate::models::*;
use crate::server::app_state::AppState;

pub async fn health() -> &'static str {
    "ok"
}

pub async fn list_sessions(State(state): State<AppState>) -> Json<Vec<Session>> {
    Json(state.sessions.list().await)
}

pub async fn register_session(
    State(state): State<AppState>,
    Json(request): Json<RegisterSessionRequest>,
) -> (StatusCode, Json<Session>) {
    let session = state.sessions.register(request).await;
    let _ = state.event_tx.send(WsEvent::SessionConnected {
        session: session.clone(),
    });
    (StatusCode::CREATED, Json(session))
}

pub async fn unregister_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> StatusCode {
    if let Some(_session) = state.sessions.unregister(&session_id).await {
        state.messages.remove_session(&session_id).await;
        let _ = state.event_tx.send(WsEvent::SessionDisconnected {
            session_id,
        });
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

pub async fn heartbeat(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> StatusCode {
    if state.sessions.heartbeat(&session_id).await {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

pub async fn rename_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<RenameSessionRequest>,
) -> StatusCode {
    if state.sessions.rename(&session_id, request.name).await.is_some() {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

pub async fn update_session_status(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<UpdateStatusRequest>,
) -> StatusCode {
    let status = request.status.clone();
    let detail = request.detail.clone();
    let silent = request.silent;
    if state.sessions.update_status(&session_id, request).await.is_some() {
        let _ = state.event_tx.send(WsEvent::StatusChanged {
            session_id: session_id.clone(),
            status: status.clone(),
            detail: detail.clone(),
        });

        // Auto-create a message from status updates that have detail text
        // so they appear in the session's message feed (skip when silent)
        if !silent {
        if let Some(detail_text) = &detail {
            let status_label = match &status {
                SessionStatus::Running => "Running",
                SessionStatus::WaitingForInput => "Waiting for input",
                SessionStatus::Thinking => "Thinking",
                SessionStatus::Error => "Error",
                SessionStatus::Idle => "Idle",
            };
            let msg_type = match &status {
                SessionStatus::Error => MessageType::Error,
                SessionStatus::WaitingForInput => MessageType::Question,
                SessionStatus::Idle => MessageType::Completion,
                _ => MessageType::Info,
            };
            let content = format!("[{}] {}", status_label, detail_text);
            let message = state
                .messages
                .add_message(&session_id, MessageFrom::Session, None, content, msg_type)
                .await;
            let _ = state.event_tx.send(WsEvent::NewMessage {
                message,
            });
        }
        }

        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

pub async fn send_message(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<SendMessageRequest>,
) -> (StatusCode, Json<Message>) {
    let message = state
        .messages
        .add_message(
            &session_id,
            MessageFrom::Session,
            None,
            request.message,
            request.message_type,
        )
        .await;
    let _ = state.event_tx.send(WsEvent::NewMessage {
        message: message.clone(),
    });
    (StatusCode::CREATED, Json(message))
}

pub async fn send_user_message(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<SendMessageRequest>,
) -> (StatusCode, Json<Message>) {
    let message = state
        .messages
        .add_message(
            &session_id,
            MessageFrom::User,
            None,
            request.message,
            request.message_type,
        )
        .await;
    let _ = state.event_tx.send(WsEvent::NewMessage {
        message: message.clone(),
    });
    (StatusCode::CREATED, Json(message))
}

pub async fn get_messages(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<GetMessagesRequest>,
) -> Json<Vec<Message>> {
    let messages = state
        .messages
        .get_messages(&session_id, request.since, request.unread_only)
        .await;
    Json(messages)
}

pub async fn get_all_messages(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Json<Vec<Message>> {
    Json(state.messages.get_all_messages(&session_id).await)
}

pub async fn broadcast_message(
    State(state): State<AppState>,
    Path(sender_session_id): Path<String>,
    Json(request): Json<BroadcastRequest>,
) -> StatusCode {
    let sender = state.sessions.get(&sender_session_id).await;
    let sender_name = sender.map(|s| s.project_name).unwrap_or_default();
    let sessions = state.sessions.list().await;

    for session in &sessions {
        if session.id != sender_session_id {
            let message = state
                .messages
                .add_message(
                    &session.id,
                    MessageFrom::Broadcast,
                    Some(sender_name.clone()),
                    request.message.clone(),
                    MessageType::Info,
                )
                .await;
            let _ = state.event_tx.send(WsEvent::NewMessage {
                message,
            });
        }
    }
    StatusCode::OK
}

pub async fn clear_messages(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> StatusCode {
    state.messages.clear_messages(&session_id).await;
    StatusCode::OK
}

pub async fn notify(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<NotifyRequest>,
) -> StatusCode {
    let _ = state.event_tx.send(WsEvent::Notification {
        session_id,
        title: request.title,
        body: request.body,
        priority: request.priority,
    });
    StatusCode::OK
}
