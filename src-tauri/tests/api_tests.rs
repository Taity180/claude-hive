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

// ── Questions ──────────────────────────────────────────────────────────

use claude_hive_lib::models::{Question, SessionStatus};

async fn register(server: &TestServer) -> Session {
    server
        .post("/api/sessions")
        .json(&json!({ "workingDirectory": "/home/user/my-project" }))
        .await
        .json()
}

async fn ask(server: &TestServer, session_id: &str) -> Question {
    server
        .post(&format!("/api/sessions/{}/ask", session_id))
        .json(&json!({
            "question": "JWT or session cookies?",
            "options": ["JWT", "Session cookies"]
        }))
        .await
        .json()
}

#[tokio::test]
async fn ask_stores_the_question_and_blocks_the_session() {
    let server = test_server();
    let session = register(&server).await;

    let question = ask(&server, &session.id).await;
    assert_eq!(question.options.len(), 2);
    assert!(question.answer.is_none());

    // Asking flips the pill to waiting without the model having to remember.
    let sessions: Vec<Session> = server.get("/api/sessions").await.json();
    assert_eq!(sessions[0].status, SessionStatus::WaitingForInput);
}

#[tokio::test]
async fn ask_rejects_a_question_with_too_few_options() {
    let server = test_server();
    let session = register(&server).await;

    let response = server
        .post(&format!("/api/sessions/{}/ask", session.id))
        .json(&json!({ "question": "Proceed?", "options": ["Yes"] }))
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ask_rejects_an_unknown_session() {
    let server = test_server();

    let response = server
        .post("/api/sessions/nope/ask")
        .json(&json!({ "question": "Proceed?", "options": ["Yes", "No"] }))
        .await;

    response.assert_status(StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn answering_records_the_choice_and_unblocks_the_session() {
    let server = test_server();
    let session = register(&server).await;
    let question = ask(&server, &session.id).await;

    let response = server
        .post(&format!("/api/sessions/{}/ask/answer", session.id))
        .json(&json!({ "questionId": question.id, "answer": ["JWT"] }))
        .await;
    response.assert_status_ok();

    // hub_ask polls this endpoint for its own answer.
    let stored: Option<Question> = server
        .get(&format!("/api/sessions/{}/ask", session.id))
        .await
        .json();
    assert_eq!(stored.unwrap().answer, Some(vec!["JWT".to_string()]));

    let sessions: Vec<Session> = server.get("/api/sessions").await.json();
    assert_eq!(sessions[0].status, SessionStatus::Running);
}

#[tokio::test]
async fn answering_echoes_the_choice_into_the_message_feed() {
    let server = test_server();
    let session = register(&server).await;
    let question = ask(&server, &session.id).await;

    server
        .post(&format!("/api/sessions/{}/ask/answer", session.id))
        .json(&json!({ "questionId": question.id, "answer": ["JWT"] }))
        .await
        .assert_status_ok();

    let messages: Vec<claude_hive_lib::models::Message> = server
        .get(&format!("/api/sessions/{}/messages", session.id))
        .await
        .json();
    let contents: Vec<&str> = messages.iter().map(|m| m.content.as_str()).collect();
    assert!(contents.contains(&"JWT or session cookies?"));
    assert!(contents.contains(&"JWT"));
}

#[tokio::test]
async fn answering_rejects_an_option_that_was_never_offered() {
    let server = test_server();
    let session = register(&server).await;
    let question = ask(&server, &session.id).await;

    let response = server
        .post(&format!("/api/sessions/{}/ask/answer", session.id))
        .json(&json!({ "questionId": question.id, "answer": ["OAuth"] }))
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn answering_a_replaced_question_conflicts() {
    let server = test_server();
    let session = register(&server).await;
    let stale = ask(&server, &session.id).await;
    ask(&server, &session.id).await;

    let response = server
        .post(&format!("/api/sessions/{}/ask/answer", session.id))
        .json(&json!({ "questionId": stale.id, "answer": ["JWT"] }))
        .await;

    response.assert_status(StatusCode::CONFLICT);
}

#[tokio::test]
async fn pending_questions_lists_only_unanswered_ones() {
    let server = test_server();
    let first = register(&server).await;
    let second = register(&server).await;
    let answered = ask(&server, &first.id).await;
    ask(&server, &second.id).await;

    server
        .post(&format!("/api/sessions/{}/ask/answer", first.id))
        .json(&json!({ "questionId": answered.id, "answer": ["JWT"] }))
        .await
        .assert_status_ok();

    let pending: Vec<Question> = server.get("/api/questions").await.json();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].session_id, second.id);
}

#[tokio::test]
async fn unregistering_a_session_drops_its_question() {
    let server = test_server();
    let session = register(&server).await;
    ask(&server, &session.id).await;

    server.delete(&format!("/api/sessions/{}", session.id)).await;

    let pending: Vec<Question> = server.get("/api/questions").await.json();
    assert!(pending.is_empty());
}
