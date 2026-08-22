use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::mcp::agent_dispatch::dispatch;
use crate::mcp::agent_tools::SERVER_INSTRUCTIONS;
use crate::models::{Agent, AgentApp, AgentPost};
use crate::server::app_state::AppState;

/// Extract a bearer token, tolerating case in the scheme as RFC 7235 requires.
pub fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let raw = headers.get("authorization")?.to_str().ok()?;
    let (scheme, token) = raw.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    let token = token.trim();
    (!token.is_empty()).then_some(token)
}

/// The URL an agent should be pointed at. Bound to the configured port rather
/// than a constant, so the Agents pane never hands out a dead address.
fn mcp_endpoint_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/mcp")
}

fn configured_port() -> u16 {
    std::env::var("CLAUDE_HIVE_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(9400)
}

/// MCP over HTTP. The stdio server in `mcp/handler.rs` serves Claude Code,
/// which spawns it as a child process; an external agent has no such route in,
/// so it speaks JSON-RPC here instead.
pub async fn mcp_endpoint(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let Some(token) = bearer_token(&headers) else {
        return (
            StatusCode::UNAUTHORIZED,
            "missing Authorization: Bearer <token> header",
        )
            .into_response();
    };

    let agent_id = state.agent_tokens.read().await.agent_id_for(token);
    let Some(agent_id) = agent_id else {
        return (StatusCode::UNAUTHORIZED, "unknown token").into_response();
    };

    let method = body.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = body.get("id").cloned();
    let params = body.get("params").cloned();

    match dispatch(&state, &agent_id, method, id, params).await {
        Some(response) => Json(response).into_response(),
        // A notification: acknowledged, no body.
        None => StatusCode::ACCEPTED.into_response(),
    }
}

pub async fn list_agents(State(state): State<AppState>) -> Json<Vec<Agent>> {
    Json(state.agents.list().await)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppRow {
    pub agent_id: String,
    pub agent_name: String,
    #[serde(flatten)]
    pub app: AgentApp,
}

/// Every declared app with its owning agent, for the apps bar.
pub async fn agent_apps(State(state): State<AppState>) -> Json<Vec<AgentAppRow>> {
    let pairs = state.agents.all_apps().await;
    let mut rows = Vec::with_capacity(pairs.len());
    for (agent_id, app) in pairs {
        let agent_name = state
            .agents
            .get(&agent_id)
            .await
            .map(|a| a.name)
            .unwrap_or_else(|| "Unknown agent".to_string());
        rows.push(AgentAppRow { agent_id, agent_name, app });
    }
    Json(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostsQuery {
    pub app_id: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    100
}

pub async fn agent_posts(
    State(state): State<AppState>,
    Query(query): Query<PostsQuery>,
) -> Json<Vec<AgentPost>> {
    let limit = query.limit.clamp(1, 500);
    let posts = match query.app_id {
        Some(app_id) => state.agent_feed.for_app(&app_id, limit).await,
        None => state.agent_feed.recent(limit).await,
    };
    Json(posts)
}

#[derive(Debug, Deserialize)]
pub struct ReplyRequest {
    pub message: String,
}

/// Queue a reply for an agent to collect. It cannot be pushed: MCP is
/// request/response, so it waits here until the agent calls `agent_inbox`.
pub async fn reply_to_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    Json(request): Json<ReplyRequest>,
) -> StatusCode {
    if state.agents.get(&agent_id).await.is_none() {
        return StatusCode::NOT_FOUND;
    }
    if request.message.trim().is_empty() {
        return StatusCode::BAD_REQUEST;
    }
    state
        .agent_feed
        .enqueue_reply(&agent_id, request.message)
        .await;
    StatusCode::ACCEPTED
}

#[derive(Debug, Deserialize)]
pub struct EnabledRequest {
    pub enabled: bool,
}

pub async fn set_agent_enabled(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    Json(request): Json<EnabledRequest>,
) -> StatusCode {
    if state.agents.set_enabled(&agent_id, request.enabled).await {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub endpoint: String,
    pub token: Option<String>,
    pub prompt_block: String,
}

/// What the Agents pane hands the user: where to point the agent, a token, and
/// the prompt that makes it actually post.
pub async fn agent_connection_info(State(state): State<AppState>) -> Json<ConnectionInfo> {
    let token = state
        .agent_tokens
        .read()
        .await
        .tokens()
        .into_iter()
        .map(|(token, _)| token)
        .next();

    Json(ConnectionInfo {
        endpoint: mcp_endpoint_url(configured_port()),
        token,
        prompt_block: SERVER_INSTRUCTIONS.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn reads_a_bearer_token() {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", HeaderValue::from_static("Bearer hive_ag_abc"));
        assert_eq!(bearer_token(&headers), Some("hive_ag_abc"));
    }

    #[test]
    fn accepts_the_scheme_in_any_case() {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", HeaderValue::from_static("bearer hive_ag_abc"));
        assert_eq!(bearer_token(&headers), Some("hive_ag_abc"));
    }

    #[test]
    fn rejects_a_missing_or_malformed_header() {
        assert_eq!(bearer_token(&HeaderMap::new()), None);

        let mut basic = HeaderMap::new();
        basic.insert("authorization", HeaderValue::from_static("Basic abc"));
        assert_eq!(bearer_token(&basic), None);

        let mut bare = HeaderMap::new();
        bare.insert("authorization", HeaderValue::from_static("Bearer"));
        assert_eq!(bearer_token(&bare), None);

        let mut empty = HeaderMap::new();
        empty.insert("authorization", HeaderValue::from_static("Bearer   "));
        assert_eq!(bearer_token(&empty), None, "whitespace is not a token");
    }

    #[test]
    fn the_connection_endpoint_points_at_the_configured_port() {
        // The mockups said 4317; the real server is on CLAUDE_HIVE_PORT,
        // default 9400. Handing the user the wrong URL would be a dead end.
        assert_eq!(mcp_endpoint_url(9455), "http://127.0.0.1:9455/mcp");
        assert_eq!(mcp_endpoint_url(9400), "http://127.0.0.1:9400/mcp");
    }
}
