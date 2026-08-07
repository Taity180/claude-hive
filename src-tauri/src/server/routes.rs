use axum::{
    extract::State,
    extract::Path,
    http::StatusCode,
    Json,
};

use crate::models::*;
use crate::server::app_state::AppState;
use crate::state::AnswerError;

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
        state.questions.remove_session(&session_id).await;
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

/// Mark messages as delivered so they are not handed out again.
///
/// Without this the `read` flag never flips, `unreadOnly` filters nothing, and
/// anything that injects pending messages would re-inject the same ones every
/// time it looked.
pub async fn mark_messages_read(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<MarkReadRequest>,
) -> StatusCode {
    state.messages.mark_read(&session_id, &request.message_ids).await;
    StatusCode::OK
}

/// Raise something the user should notice.
///
/// Native OS toasts were removed, so this persists to the session feed and
/// leaves the dashboard to flag it unread. A tool that quietly did nothing
/// would be worse than no tool.
pub async fn notify(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<NotifyRequest>,
) -> StatusCode {
    let content = if request.body.is_empty() {
        request.title.clone()
    } else {
        format!("{} — {}", request.title, request.body)
    };
    let message = state
        .messages
        .add_message(&session_id, MessageFrom::Session, None, content, MessageType::Completion)
        .await;
    let _ = state.event_tx.send(WsEvent::NewMessage { message });

    let _ = state.event_tx.send(WsEvent::Notification {
        session_id,
        title: request.title,
        body: request.body,
        priority: request.priority,
    });
    StatusCode::OK
}

// ── Token usage ────────────────────────────────────────────────────────

/// Token usage read out of Claude Code's transcripts.
///
/// `today` covers every session on the machine — including ones that never
/// connected to the hive — because "how much have I used today" is an
/// account-level question, not a per-dashboard one.
pub async fn get_usage(State(state): State<AppState>) -> Json<UsageSnapshot> {
    let connected: Vec<String> = state
        .sessions
        .list()
        .await
        .into_iter()
        .filter_map(|s| s.claude_session_id)
        .collect();
    Json(state.usage.snapshot(&connected).await)
}

/// How much of the plan's rate-limit windows are spent, and when they reset.
///
/// Separate from `/api/usage` because it has a different source and different
/// failure modes: token-authenticated, network-dependent, and undocumented.
pub async fn get_plan_usage(State(state): State<AppState>) -> Json<PlanUsageSnapshot> {
    Json(state.plan_usage.snapshot().await)
}

/// Link a hive session to the Claude Code session whose transcript holds its
/// usage. Only a hook knows this pairing, so a hook reports it.
pub async fn set_claude_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<SetClaudeSessionRequest>,
) -> StatusCode {
    if state
        .sessions
        .set_claude_session_id(&session_id, request.claude_session_id)
        .await
    {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

// ── Questions ──────────────────────────────────────────────────────────
//
// A question is a message the session is blocked on. Asking one flips the
// session to waiting_for_input and answering it flips it back, which makes the
// status pill reflect reality rather than depending on the model remembering
// to call hub_set_status.

/// Move a session's status and tell the dashboard, without the feed message
/// `update_session_status` would add — questions post their own.
async fn set_status_silently(
    state: &AppState,
    session_id: &str,
    status: SessionStatus,
    detail: Option<String>,
) {
    let updated = state
        .sessions
        .update_status(
            session_id,
            UpdateStatusRequest {
                status: status.clone(),
                detail: detail.clone(),
                silent: true,
            },
        )
        .await;

    if updated.is_some() {
        let _ = state.event_tx.send(WsEvent::StatusChanged {
            session_id: session_id.to_string(),
            status,
            detail,
        });
    }
}

pub async fn ask_question(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<AskRequest>,
) -> Result<(StatusCode, Json<Question>), (StatusCode, String)> {
    if let Some(error) = request.validation_error() {
        return Err((StatusCode::BAD_REQUEST, error));
    }
    if state.sessions.get(&session_id).await.is_none() {
        return Err((StatusCode::NOT_FOUND, "unknown session".to_string()));
    }

    let question = state.questions.ask(&session_id, request).await;

    set_status_silently(
        &state,
        &session_id,
        SessionStatus::WaitingForInput,
        Some(question.question.clone()),
    )
    .await;

    let message = state
        .messages
        .add_message(
            &session_id,
            MessageFrom::Session,
            None,
            question.question.clone(),
            MessageType::Question,
        )
        .await;
    let _ = state.event_tx.send(WsEvent::NewMessage { message });
    let _ = state.event_tx.send(WsEvent::QuestionAsked {
        question: question.clone(),
    });

    Ok((StatusCode::CREATED, Json(question)))
}

/// The session's current question, answered or not. `hub_ask` polls this for
/// its answer; the dashboard uses it to restore a prompt after a reload.
pub async fn get_question(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Json<Option<Question>> {
    Json(state.questions.get(&session_id).await)
}

/// Every unanswered question, so a dashboard that just opened can show the
/// prompts it missed.
pub async fn list_pending_questions(State(state): State<AppState>) -> Json<Vec<Question>> {
    Json(state.questions.all_pending().await)
}

pub async fn answer_question(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<AnswerRequest>,
) -> Result<(StatusCode, Json<Question>), (StatusCode, String)> {
    let answered = state
        .questions
        .answer(&session_id, &request.question_id, request.answer)
        .await
        .map_err(|e| match e {
            AnswerError::NoPendingQuestion => {
                (StatusCode::NOT_FOUND, "no question is outstanding".to_string())
            }
            AnswerError::StaleQuestion => (
                StatusCode::CONFLICT,
                "that question has been replaced by a newer one".to_string(),
            ),
            AnswerError::AlreadyAnswered => {
                (StatusCode::CONFLICT, "that question is already answered".to_string())
            }
            AnswerError::InvalidChoice(reason) => (StatusCode::BAD_REQUEST, reason),
        })?;

    let answer = answered.answer.clone().unwrap_or_default();

    // Echo the choice into the feed so the exchange reads as a conversation,
    // and hand it to the session the same way a typed reply arrives.
    let message = state
        .messages
        .add_message(
            &session_id,
            MessageFrom::User,
            None,
            answer.join(", "),
            MessageType::Info,
        )
        .await;
    let _ = state.event_tx.send(WsEvent::NewMessage { message });

    set_status_silently(
        &state,
        &session_id,
        SessionStatus::Running,
        Some("Answer received".to_string()),
    )
    .await;

    let _ = state.event_tx.send(WsEvent::QuestionAnswered {
        session_id,
        question_id: answered.id.clone(),
        answer,
    });

    Ok((StatusCode::OK, Json(answered)))
}
