use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::models::{Actor, Task, WsEvent};
use crate::server::app_state::AppState;

/// Trim and reject blank. Extracted so it is testable without a router.
pub fn validate_title(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// The inner halves exist so the behaviour is testable without spinning up a
/// router — axum extractors are awkward to construct by hand.
pub async fn create_task_inner(
    state: &AppState,
    title: String,
    due: Option<DateTime<Utc>>,
) -> Task {
    let task = state.tasks.create_for_user(title, due).await;
    let _ = state
        .event_tx
        .send(WsEvent::TaskUpserted { task: task.clone() });
    task
}

pub async fn set_done_inner(state: &AppState, id: &str, done: bool) -> bool {
    // From the UI, so the actor is always the user. An agent completing
    // something comes through tasks_complete and is labelled differently.
    if !state.tasks.set_done(id, done, Actor::User).await {
        return false;
    }
    if let Some(task) = state.tasks.get(id).await {
        let _ = state.event_tx.send(WsEvent::TaskUpserted { task });
    }
    true
}

pub async fn list_tasks(State(state): State<AppState>) -> Json<Vec<Task>> {
    Json(state.tasks.list().await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub title: String,
    pub due: Option<DateTime<Utc>>,
}

pub async fn create_task(
    State(state): State<AppState>,
    Json(request): Json<CreateTaskRequest>,
) -> Result<(StatusCode, Json<Task>), StatusCode> {
    let Some(title) = validate_title(&request.title) else {
        return Err(StatusCode::BAD_REQUEST);
    };
    let task = create_task_inner(&state, title, request.due).await;
    Ok((StatusCode::CREATED, Json(task)))
}

#[derive(Debug, Deserialize)]
pub struct DoneRequest {
    pub done: bool,
}

pub async fn set_task_done(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<DoneRequest>,
) -> StatusCode {
    if set_done_inner(&state, &id, request.done).await {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

#[derive(Debug, Deserialize)]
pub struct NoteRequest {
    pub body: String,
}

pub async fn add_task_note(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<NoteRequest>,
) -> StatusCode {
    let Some(body) = validate_title(&request.body) else {
        return StatusCode::BAD_REQUEST;
    };
    if !state.tasks.add_note(&id, Actor::User, body).await {
        return StatusCode::NOT_FOUND;
    }
    if let Some(task) = state.tasks.get(&id).await {
        let _ = state.event_tx.send(WsEvent::TaskUpserted { task });
    }
    StatusCode::OK
}

pub async fn delete_task(State(state): State<AppState>, Path(id): Path<String>) -> StatusCode {
    if state.tasks.remove(&id).await {
        let _ = state.event_tx.send(WsEvent::TaskRemoved { task_id: id });
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        (AppState::with_token_dir(dir.path()), dir)
    }

    #[tokio::test]
    async fn a_user_created_task_has_no_agent() {
        let (state, _dir) = state();
        let task = create_task_inner(&state, "Buy milk".into(), None).await;
        assert!(
            task.agent_id.is_none(),
            "the user's own task belongs to nobody else"
        );
        assert!(task.external_id.is_none());
    }

    #[tokio::test]
    async fn completing_from_the_ui_is_attributed_to_the_user() {
        // The distinction the whole feature rests on: the user's tick must not
        // look like an agent's.
        let (state, _dir) = state();
        let task = create_task_inner(&state, "Thing".into(), None).await;
        assert!(set_done_inner(&state, &task.id, true).await);
        let after = state.tasks.get(&task.id).await.unwrap();
        assert!(matches!(after.completed_by, Some(Actor::User)));
    }

    #[tokio::test]
    async fn completing_something_unknown_reports_false() {
        let (state, _dir) = state();
        assert!(!set_done_inner(&state, "nope", true).await);
    }

    #[tokio::test]
    async fn a_blank_title_is_refused() {
        let (state, _dir) = state();
        assert!(validate_title("   ").is_none());
        assert!(validate_title("").is_none());
        assert_eq!(validate_title("  Real  "), Some("Real".to_string()));
        assert!(state.tasks.list().await.is_empty());
    }

    #[tokio::test]
    async fn creating_a_task_broadcasts_so_the_pane_updates() {
        let (state, _dir) = state();
        let mut rx = state.event_tx.subscribe();
        create_task_inner(&state, "Thing".into(), None).await;

        match rx.try_recv().expect("a new task must emit an event") {
            WsEvent::TaskUpserted { task } => assert_eq!(task.title, "Thing"),
            other => panic!("expected TaskUpserted, got {other:?}"),
        }
    }
}
