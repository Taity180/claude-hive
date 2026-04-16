use axum::http::StatusCode;
use axum_test::TestServer;
use serde_json::json;

use claude_hive_lib::server::{create_router, AppState};
use claude_hive_lib::models::Session;

fn test_server() -> TestServer {
    let state = AppState::new();
    let router = create_router(state, None);
    TestServer::new(router)
}

#[tokio::test]
async fn health_returns_ok() {
    let server = test_server();
    let response = server.get("/api/health").await;
    response.assert_status_ok();
    response.assert_text("ok");
}

#[tokio::test]
async fn register_and_list_sessions() {
    let server = test_server();

    let response = server
        .post("/api/sessions")
        .json(&json!({
            "workingDirectory": "/home/user/my-project",
            "gitBranch": "main"
        }))
        .await;
    response.assert_status(StatusCode::CREATED);

    let session: Session = response.json();
    assert_eq!(session.project_name, "my-project");

    let response = server.get("/api/sessions").await;
    let sessions: Vec<Session> = response.json();
    assert_eq!(sessions.len(), 1);
}

#[tokio::test]
async fn update_status() {
    let server = test_server();

    let response = server
        .post("/api/sessions")
        .json(&json!({ "workingDirectory": "/tmp/test" }))
        .await;
    let session: Session = response.json();

    let response = server
        .put(&format!("/api/sessions/{}/status", session.id))
        .json(&json!({ "status": "waiting_for_input", "detail": "Need help" }))
        .await;
    response.assert_status_ok();
}

#[tokio::test]
async fn send_and_get_messages() {
    let server = test_server();

    let response = server
        .post("/api/sessions")
        .json(&json!({ "workingDirectory": "/tmp/test" }))
        .await;
    let session: Session = response.json();

    server
        .post(&format!("/api/sessions/{}/messages", session.id))
        .json(&json!({ "message": "Working on feature X" }))
        .await
        .assert_status(StatusCode::CREATED);

    let response = server
        .get(&format!("/api/sessions/{}/messages", session.id))
        .await;
    let messages: Vec<serde_json::Value> = response.json();
    assert_eq!(messages.len(), 1);
}

#[tokio::test]
async fn unregister_session() {
    let server = test_server();

    let response = server
        .post("/api/sessions")
        .json(&json!({ "workingDirectory": "/tmp/test" }))
        .await;
    let session: Session = response.json();

    server
        .delete(&format!("/api/sessions/{}", session.id))
        .await
        .assert_status_ok();

    let response = server.get("/api/sessions").await;
    let sessions: Vec<Session> = response.json();
    assert_eq!(sessions.len(), 0);
}
