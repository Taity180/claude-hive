use axum::http::StatusCode;
use axum_test::TestServer;
use serde_json::json;

use claude_hive_lib::server::{create_router, AppState};
use claude_hive_lib::models::Session;

/// A server whose persisted files live in a temp directory.
///
/// Never `AppState::new()` here: it reads and writes the real user config
/// directory, so running this suite would mutate the developer's own tasks and
/// declared agents. The directory is deliberately leaked rather than threaded
/// through every test as a guard — the test process is about to exit anyway.
fn test_server() -> TestServer {
    let dir: &'static tempfile::TempDir = Box::leak(Box::new(tempfile::tempdir().unwrap()));
    let state = AppState::with_token_dir(dir.path());
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

// ── Token usage ────────────────────────────────────────────────────────

use claude_hive_lib::models::UsageSnapshot;

#[tokio::test]
async fn usage_starts_empty_and_does_not_error() {
    let server = test_server();
    let response = server.get("/api/usage").await;
    response.assert_status_ok();

    let snapshot: UsageSnapshot = response.json();
    assert!(snapshot.sessions.is_empty());
    assert_eq!(snapshot.today.total(), 0);
}

#[tokio::test]
async fn a_hook_can_link_a_session_to_its_claude_session_id() {
    let server = test_server();
    let session = register(&server).await;
    assert_eq!(session.claude_session_id, None);

    server
        .put(&format!("/api/sessions/{}/claude-session", session.id))
        .json(&json!({ "claudeSessionId": "claude-abc" }))
        .await
        .assert_status_ok();

    let sessions: Vec<Session> = server.get("/api/sessions").await.json();
    assert_eq!(sessions[0].claude_session_id, Some("claude-abc".to_string()));
}

#[tokio::test]
async fn linking_an_unknown_session_is_a_not_found() {
    let server = test_server();
    let response = server
        .put("/api/sessions/nope/claude-session")
        .json(&json!({ "claudeSessionId": "claude-abc" }))
        .await;
    response.assert_status(StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn re_registering_keeps_the_transcript_link() {
    // A hive restart re-registers the session under the same id; losing the
    // link here would silently orphan its usage until the next Stop hook.
    let server = test_server();
    let session = register(&server).await;
    server
        .put(&format!("/api/sessions/{}/claude-session", session.id))
        .json(&json!({ "claudeSessionId": "claude-abc" }))
        .await
        .assert_status_ok();

    server
        .post("/api/sessions")
        .json(&json!({ "id": session.id, "workingDirectory": "/home/user/my-project" }))
        .await
        .assert_status(StatusCode::CREATED);

    let sessions: Vec<Session> = server.get("/api/sessions").await.json();
    assert_eq!(sessions[0].claude_session_id, Some("claude-abc".to_string()));
}

// ── Message delivery ───────────────────────────────────────────────────

#[tokio::test]
async fn marking_messages_read_stops_them_being_pending() {
    let server = test_server();
    let session = register(&server).await;

    let msg: claude_hive_lib::models::Message = server
        .post(&format!("/api/sessions/{}/messages/user", session.id))
        .json(&json!({ "message": "look at this" }))
        .await
        .json();

    let unread: Vec<claude_hive_lib::models::Message> = server
        .post(&format!("/api/sessions/{}/messages/query", session.id))
        .json(&json!({ "unreadOnly": true }))
        .await
        .json();
    assert_eq!(unread.len(), 1);

    server
        .post(&format!("/api/sessions/{}/messages/read", session.id))
        .json(&json!({ "messageIds": [msg.id] }))
        .await
        .assert_status_ok();

    // Without this the same message is injected on every turn, forever.
    let unread: Vec<claude_hive_lib::models::Message> = server
        .post(&format!("/api/sessions/{}/messages/query", session.id))
        .json(&json!({ "unreadOnly": true }))
        .await
        .json();
    assert!(unread.is_empty());

    // Still readable in the feed — marking read is not deleting.
    let all: Vec<claude_hive_lib::models::Message> = server
        .get(&format!("/api/sessions/{}/messages", session.id))
        .await
        .json();
    assert_eq!(all.len(), 1);
}

#[tokio::test]
async fn marking_an_unknown_id_read_is_harmless() {
    let server = test_server();
    let session = register(&server).await;

    server
        .post(&format!("/api/sessions/{}/messages/read", session.id))
        .json(&json!({ "messageIds": ["no-such-id"] }))
        .await
        .assert_status_ok();
}

#[tokio::test]
async fn notify_lands_in_the_feed_now_that_toasts_are_gone() {
    let server = test_server();
    let session = register(&server).await;

    server
        .post(&format!("/api/sessions/{}/notify", session.id))
        .json(&json!({ "title": "Done", "body": "Tests passing" }))
        .await
        .assert_status_ok();

    // A tool that quietly did nothing would be worse than no tool.
    let all: Vec<claude_hive_lib::models::Message> = server
        .get(&format!("/api/sessions/{}/messages", session.id))
        .await
        .json();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].content, "Done — Tests passing");
}

#[tokio::test]
async fn notify_without_a_body_uses_just_the_title() {
    let server = test_server();
    let session = register(&server).await;

    server
        .post(&format!("/api/sessions/{}/notify", session.id))
        .json(&json!({ "title": "Done", "body": "" }))
        .await
        .assert_status_ok();

    let all: Vec<claude_hive_lib::models::Message> = server
        .get(&format!("/api/sessions/{}/messages", session.id))
        .await
        .json();
    assert_eq!(all[0].content, "Done");
}


/// The token the rail hands an agent, so a test can speak MCP as one.
async fn agent_token(server: &TestServer) -> String {
    let info: serde_json::Value = server.get("/api/agents/connection").await.json();
    info["token"].as_str().expect("a token").to_string()
}

async fn mcp(server: &TestServer, token: &str, body: serde_json::Value) -> serde_json::Value {
    server
        .post("/mcp")
        .add_header("authorization", format!("Bearer {token}"))
        .json(&body)
        .await
        .json()
}

async fn connect_agent(server: &TestServer) -> String {
    let token = agent_token(server).await;
    mcp(
        server,
        &token,
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "clientInfo": { "name": "Grok Bot", "version": "1" } }
        }),
    )
    .await;
    token
}

#[tokio::test]
async fn an_agent_question_reaches_the_rail_and_its_answer_reaches_the_agent() {
    let server = test_server();
    let token = connect_agent(&server).await;

    mcp(
        &server,
        &token,
        json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {
                "name": "agent_ask",
                "arguments": {
                    "question": "Reply to Sarah now?",
                    "options": ["Yes", "Later"],
                    "app_id": "gmail",
                    "wait_seconds": 0
                }
            }
        }),
    )
    .await;

    // The rail hydrates from here when it opens.
    let pending: Vec<serde_json::Value> = server.get("/api/agents/questions").await.json();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0]["question"], "Reply to Sarah now?");
    assert_eq!(pending[0]["appId"], "gmail");
    let question_id = pending[0]["id"].as_str().unwrap().to_string();

    // The click.
    let answered = server
        .post(&format!("/api/agents/questions/{question_id}/answer"))
        .json(&json!({ "choice": "Later" }))
        .await;
    answered.assert_status_ok();

    // Answered questions leave the pending list…
    let still_pending: Vec<serde_json::Value> = server.get("/api/agents/questions").await.json();
    assert!(still_pending.is_empty());

    // …and the agent collects the choice.
    let result = mcp(
        &server,
        &token,
        json!({
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": { "name": "agent_ask_result", "arguments": { "question_id": question_id } }
        }),
    )
    .await;
    assert!(
        result["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Later"),
        "{result}"
    );
}

#[tokio::test]
async fn answering_an_agent_question_twice_conflicts() {
    let server = test_server();
    let token = connect_agent(&server).await;
    mcp(
        &server,
        &token,
        json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {
                "name": "agent_ask",
                "arguments": { "question": "Now?", "options": ["Yes", "No"], "wait_seconds": 0 }
            }
        }),
    )
    .await;
    let pending: Vec<serde_json::Value> = server.get("/api/agents/questions").await.json();
    let id = pending[0]["id"].as_str().unwrap().to_string();

    server
        .post(&format!("/api/agents/questions/{id}/answer"))
        .json(&json!({ "choice": "Yes" }))
        .await
        .assert_status_ok();

    // Two windows can show the same question; the second click must not
    // overwrite the first answer.
    server
        .post(&format!("/api/agents/questions/{id}/answer"))
        .json(&json!({ "choice": "No" }))
        .await
        .assert_status(StatusCode::CONFLICT);
}

#[tokio::test]
async fn an_answer_that_is_not_on_offer_is_rejected() {
    let server = test_server();
    let token = connect_agent(&server).await;
    mcp(
        &server,
        &token,
        json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {
                "name": "agent_ask",
                "arguments": { "question": "Now?", "options": ["Yes", "No"], "wait_seconds": 0 }
            }
        }),
    )
    .await;
    let pending: Vec<serde_json::Value> = server.get("/api/agents/questions").await.json();
    let id = pending[0]["id"].as_str().unwrap().to_string();

    server
        .post(&format!("/api/agents/questions/{id}/answer"))
        .json(&json!({ "choice": "Maybe" }))
        .await
        .assert_status(StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn answering_a_question_nobody_asked_is_not_found() {
    let server = test_server();
    server
        .post("/api/agents/questions/nope/answer")
        .json(&json!({ "choice": "Yes" }))
        .await
        .assert_status(StatusCode::NOT_FOUND);
}
