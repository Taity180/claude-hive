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
        .route("/ws", get(websocket::ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    match static_dir {
        Some(dir) => api_router.fallback_service(ServeDir::new(dir)),
        None => api_router,
    }
}
