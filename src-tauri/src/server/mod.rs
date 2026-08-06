pub mod app_state;
pub mod routes;
pub mod websocket;

use axum::{
    routing::{get, post, put, delete},
    Router,
};
use tower_http::cors::CorsLayer;

pub use app_state::AppState;
use routes::*;

/// Start a background task that prunes sessions with no activity for 30 seconds.
pub fn start_session_pruner(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
        loop {
            interval.tick().await;
            let pruned = state.sessions.prune_stale(chrono::Duration::seconds(30)).await;
            for id in pruned {
                tracing::info!("Pruned stale session: {}", id);
                let _ = state.event_tx.send(crate::models::WsEvent::SessionDisconnected {
                    session_id: id,
                });
            }
        }
    });
}

/// Start a background task that folds new transcript writes into the usage
/// totals every 30 seconds.
///
/// The interval is cheap because scanning is incremental: unchanged files cost
/// one `stat` each, and a changed one is read from the byte offset where the
/// last scan stopped — a few KB per turn, not the whole file.
pub fn start_usage_scanner(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            state.usage.scan().await;
        }
    });
}

/// Poll plan usage every 60 seconds.
///
/// Slower than the transcript scan because it is a network call against
/// someone else's service, and the windows it reports move over hours rather
/// than seconds. The token is re-read each time, so a rotated token or a
/// different account is picked up without a restart.
pub fn start_plan_usage_poller(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            state.plan_usage.refresh().await;
        }
    });
}

pub fn create_router(state: AppState, static_dir: Option<std::path::PathBuf>) -> Router {
    use tower_http::services::ServeDir;

    let api_router = Router::new()
        .route("/api/health", get(health))
        .route("/api/sessions", get(list_sessions))
        .route("/api/sessions", post(register_session))
        .route("/api/sessions/{session_id}", delete(unregister_session))
        .route("/api/sessions/{session_id}/heartbeat", post(heartbeat))
        .route("/api/sessions/{session_id}/name", put(rename_session))
        .route("/api/sessions/{session_id}/status", put(update_session_status))
        .route("/api/sessions/{session_id}/messages", post(send_message))
        .route("/api/sessions/{session_id}/messages", get(get_all_messages))
        .route("/api/sessions/{session_id}/messages/clear", delete(clear_messages))
        .route("/api/sessions/{session_id}/messages/query", post(get_messages))
        .route("/api/sessions/{session_id}/messages/user", post(send_user_message))
        .route("/api/sessions/{session_id}/broadcast", post(broadcast_message))
        .route("/api/sessions/{session_id}/notify", post(notify))
        .route("/api/usage", get(get_usage))
        .route("/api/usage/plan", get(get_plan_usage))
        .route("/api/sessions/{session_id}/claude-session", put(set_claude_session))
        .route("/api/questions", get(list_pending_questions))
        .route("/api/sessions/{session_id}/ask", post(ask_question))
        .route("/api/sessions/{session_id}/ask", get(get_question))
        .route("/api/sessions/{session_id}/ask/answer", post(answer_question))
        .route("/ws", get(websocket::ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    match static_dir {
        Some(dir) => api_router.fallback_service(ServeDir::new(dir)),
        None => api_router,
    }
}
