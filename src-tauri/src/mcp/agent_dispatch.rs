use serde_json::{json, Value};

use crate::mcp::agent_tools::{AGENT_TOOLS, SERVER_INSTRUCTIONS};
use crate::mcp::types::JsonRpcResponse;
use crate::models::{Actor, AgentApp, MessageType, WsEvent};
use crate::server::app_state::AppState;

/// Wrap text as an MCP tool result.
fn text_result(id: Option<Value>, text: impl Into<String>) -> JsonRpcResponse {
    JsonRpcResponse::success(
        id,
        json!({ "content": [{ "type": "text", "text": text.into() }] }),
    )
}

/// A failure the model should see and can act on, as opposed to a protocol
/// error. MCP expects tool failures in the result with `isError`, not as a
/// JSON-RPC error, so the model gets to read what went wrong and adjust.
fn tool_error(id: Option<Value>, text: impl Into<String>) -> JsonRpcResponse {
    JsonRpcResponse::success(
        id,
        json!({
            "content": [{ "type": "text", "text": text.into() }],
            "isError": true
        }),
    )
}

/// Handle one JSON-RPC request from an authenticated agent.
///
/// Pure in the sense that matters: no sockets, no HTTP, no globals. The caller
/// has already resolved `agent_id` from the bearer token, so every branch here
/// is directly testable — the same split that made the rail geometry testable
/// without a window.
///
/// Returns `None` for notifications, which per JSON-RPC take no response.
pub async fn dispatch(
    state: &AppState,
    agent_id: &str,
    method: &str,
    id: Option<Value>,
    params: Option<Value>,
) -> Option<JsonRpcResponse> {
    match method {
        "initialize" => Some(handle_initialize(state, agent_id, id, params).await),
        "tools/list" => Some(handle_tools_list(id)),
        "tools/call" => Some(handle_tools_call(state, agent_id, id, params).await),
        // Notifications are fire-and-forget.
        m if m.starts_with("notifications/") || m == "initialized" => None,
        other => Some(JsonRpcResponse::error(
            id,
            -32601,
            format!("Method not found: {other}"),
        )),
    }
}

async fn handle_initialize(
    state: &AppState,
    agent_id: &str,
    id: Option<Value>,
    params: Option<Value>,
) -> JsonRpcResponse {
    // The display name comes off the wire, so nothing is hardcoded to a
    // particular vendor. A client that sends no clientInfo, or a blank one,
    // still gets a usable row rather than an empty label in the pane.
    let client = params.as_ref().and_then(|p| p.get("clientInfo").cloned());
    let name = client
        .as_ref()
        .and_then(|c| c.get("name"))
        .and_then(|n| n.as_str())
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or("Unnamed agent")
        .to_string();
    let version = client
        .as_ref()
        .and_then(|c| c.get("version"))
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());

    let agent = state.agents.upsert(agent_id, name, version).await;
    let _ = state.event_tx.send(WsEvent::AgentConnected { agent });

    JsonRpcResponse::success(
        id,
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": {
                "name": "claude-hive-agents",
                "version": env!("CARGO_PKG_VERSION")
            },
            "instructions": SERVER_INSTRUCTIONS
        }),
    )
}

fn handle_tools_list(id: Option<Value>) -> JsonRpcResponse {
    let tools: Vec<Value> = AGENT_TOOLS
        .iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": serde_json::from_str::<Value>(t.schema)
                    .expect("tool schema must be valid JSON")
            })
        })
        .collect();
    JsonRpcResponse::success(id, json!({ "tools": tools }))
}

/// snake_case a single key, so `appId` also finds `app_id`.
fn to_snake_case(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 2);
    for ch in key.chars() {
        if ch.is_ascii_uppercase() {
            out.push('_');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

/// Accept camelCase argument names alongside the snake_case the schemas declare.
///
/// Every one of these arguments has a camelCase twin in Hive's own HTTP API, so
/// sending `appId` for `app_id` is an easy mistake — and it used to be a silent
/// one: the call succeeded, the post arrived with no provenance, and the task
/// arrived with no external id, so the next run duplicated the whole list
/// instead of updating it. Accepting both costs nothing.
///
/// Top level only. That is where every argument the tools read lives; the one
/// nested shape (`apps`) is already all-lowercase keys.
fn normalise_arg_keys(args: Value) -> Value {
    let Value::Object(map) = args else {
        return args;
    };

    let mut out = serde_json::Map::new();
    // Declared spellings first, so an agent sending both keeps the real one.
    for (key, value) in &map {
        if to_snake_case(key) == *key {
            out.insert(key.clone(), value.clone());
        }
    }
    for (key, value) in map {
        out.entry(to_snake_case(&key)).or_insert(value);
    }
    Value::Object(out)
}

async fn handle_tools_call(
    state: &AppState,
    agent_id: &str,
    id: Option<Value>,
    params: Option<Value>,
) -> JsonRpcResponse {
    let params = params.unwrap_or_else(|| json!({}));
    let tool = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
    let args = normalise_arg_keys(params.get("arguments").cloned().unwrap_or_else(|| json!({})));

    let Some(agent) = state.agents.get(agent_id).await else {
        return tool_error(
            id,
            "This token is not associated with a known agent. Call initialize first.",
        );
    };
    if !agent.enabled {
        return tool_error(
            id,
            "This agent is muted in Hive. Nothing you post will be shown until the user re-enables it.",
        );
    }
    state.agents.touch(agent_id).await;

    match tool {
        "agent_post" => {
            let Some(content) = args
                .get("content")
                .and_then(|c| c.as_str())
                .map(str::trim)
                .filter(|c| !c.is_empty())
            else {
                return tool_error(id, "agent_post requires a non-empty `content`.");
            };
            let app_id = args
                .get("app_id")
                .and_then(|a| a.as_str())
                .map(|a| a.to_string());
            let post_type: MessageType = args
                .get("type")
                .and_then(|t| t.as_str())
                .and_then(|t| serde_json::from_value(json!(t)).ok())
                .unwrap_or(MessageType::Info);

            // Safety net: a post from an app the agent never declared would
            // otherwise be attributed to something absent from the bar, leaving
            // the user unable to filter to it or mute it.
            if let Some(ref app) = app_id {
                if state.agents.ensure_app(agent_id, app).await {
                    let _ = state.event_tx.send(WsEvent::AgentAppsChanged {
                        agent_id: agent_id.to_string(),
                        apps: state.agents.apps(agent_id).await,
                    });
                }
            }

            let post = state
                .agent_feed
                .post(agent_id, &agent.name, app_id, content.to_string(), post_type)
                .await;
            let _ = state.event_tx.send(WsEvent::AgentPosted { post });
            text_result(id, "Posted.")
        }

        "agent_apps_sync" => {
            let apps: Vec<AgentApp> = args
                .get("apps")
                .cloned()
                .and_then(|a| serde_json::from_value(a).ok())
                .unwrap_or_default();
            let count = apps.len();
            state.agents.sync_apps(agent_id, apps.clone()).await;
            let _ = state.event_tx.send(WsEvent::AgentAppsChanged {
                agent_id: agent_id.to_string(),
                apps,
            });
            text_result(id, format!("{count} app(s) recorded."))
        }

        "agent_inbox" => {
            let replies = state.agent_feed.drain_replies(agent_id).await;
            if replies.is_empty() {
                return text_result(id, "No replies waiting.");
            }
            let body = replies
                .iter()
                .map(|r| format!("- {}", r.content))
                .collect::<Vec<_>>()
                .join("\n");
            text_result(
                id,
                format!("{} reply/replies from the user:\n{body}", replies.len()),
            )
        }

        "tasks_upsert" => {
            let Some(title) = args
                .get("title")
                .and_then(|t| t.as_str())
                .map(str::trim)
                .filter(|t| !t.is_empty())
            else {
                return tool_error(id, "tasks_upsert requires a non-empty `title`.");
            };
            let external_id = args
                .get("external_id")
                .and_then(|v| v.as_str())
                .map(String::from);
            let app_id = args.get("app_id").and_then(|v| v.as_str()).map(String::from);
            let source_label = args
                .get("source_label")
                .and_then(|v| v.as_str())
                .map(String::from);
            // An unparseable due date becomes no due date. Guessing would put a
            // deadline on the user's list that nothing actually stated.
            let due = args
                .get("due")
                .and_then(|v| v.as_str())
                .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
                .map(|dt| dt.with_timezone(&chrono::Utc));

            // Safety net: a post from an app the agent never declared would
            // otherwise be attributed to something absent from the bar, leaving
            // the user unable to filter to it or mute it.
            if let Some(ref app) = app_id {
                if state.agents.ensure_app(agent_id, app).await {
                    let _ = state.event_tx.send(WsEvent::AgentAppsChanged {
                        agent_id: agent_id.to_string(),
                        apps: state.agents.apps(agent_id).await,
                    });
                }
            }

            let task = state
                .tasks
                .upsert_from_agent(
                    agent_id,
                    external_id,
                    title.to_string(),
                    app_id,
                    source_label,
                    due,
                )
                .await;
            let _ = state.event_tx.send(WsEvent::TaskUpserted { task });
            text_result(id, "Task recorded.")
        }

        "tasks_list" => {
            let include_done = args
                .get("include_done")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let mut tasks = state.tasks.list().await;
            tasks.retain(|t| include_done || !t.done);
            if tasks.is_empty() {
                return text_result(id, "No tasks.");
            }
            let body = tasks
                .iter()
                .map(|t| {
                    let mark = if t.done { "[x]" } else { "[ ]" };
                    let notes = if t.notes.is_empty() {
                        String::new()
                    } else {
                        format!(
                            "\n    notes: {}",
                            t.notes
                                .iter()
                                .map(|n| n.body.as_str())
                                .collect::<Vec<_>>()
                                .join(" | ")
                        )
                    };
                    format!("{mark} {} (id {}){notes}", t.title, t.id)
                })
                .collect::<Vec<_>>()
                .join("\n");
            text_result(id, body)
        }

        "tasks_complete" => {
            let Some(task_id) = args.get("task_id").and_then(|v| v.as_str()) else {
                return tool_error(id, "tasks_complete requires `task_id`.");
            };
            let done = args.get("done").and_then(|v| v.as_bool()).unwrap_or(true);
            let actor = Actor::Agent {
                id: agent_id.to_string(),
                name: agent.name.clone(),
            };
            if !state.tasks.set_done(task_id, done, actor).await {
                return tool_error(id, format!("No task with id {task_id}."));
            }
            if let Some(task) = state.tasks.get(task_id).await {
                let _ = state.event_tx.send(WsEvent::TaskUpserted { task });
            }
            text_result(id, "Task updated.")
        }

        "tasks_note" => {
            let Some(task_id) = args.get("task_id").and_then(|v| v.as_str()) else {
                return tool_error(id, "tasks_note requires `task_id`.");
            };
            let Some(body) = args
                .get("body")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|b| !b.is_empty())
            else {
                return tool_error(id, "tasks_note requires a non-empty `body`.");
            };
            let actor = Actor::Agent {
                id: agent_id.to_string(),
                name: agent.name.clone(),
            };
            if !state.tasks.add_note(task_id, actor, body.to_string()).await {
                return tool_error(id, format!("No task with id {task_id}."));
            }
            if let Some(task) = state.tasks.get(task_id).await {
                let _ = state.event_tx.send(WsEvent::TaskUpserted { task });
            }
            text_result(id, "Note added.")
        }

        other => tool_error(id, format!("Unknown tool: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::app_state::AppState;
    use serde_json::json;

    /// A state with an isolated token dir. Never AppState::new() in a test —
    /// that reads and writes the real user config directory.
    fn test_state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::with_token_dir(dir.path());
        (state, dir)
    }

    async fn call(state: &AppState, tool: &str, args: Value) -> Value {
        let params = json!({ "name": tool, "arguments": args });
        let response = dispatch(state, "a1", "tools/call", Some(json!(1)), Some(params))
            .await
            .expect("tools/call must respond");
        serde_json::to_value(response).unwrap()
    }

    #[tokio::test]
    async fn initialize_reports_the_protocol_and_carries_instructions() {
        let (state, _dir) = test_state();
        let response = dispatch(&state, "a1", "initialize", Some(json!(1)), None)
            .await
            .unwrap();
        let value = serde_json::to_value(response).unwrap();

        assert_eq!(value["result"]["protocolVersion"], "2024-11-05");
        let instructions = value["result"]["instructions"].as_str().unwrap();
        assert!(
            instructions.contains("agent_post"),
            "instructions must tell the model to post, or it never will"
        );
    }

    #[tokio::test]
    async fn initialize_names_the_agent_from_client_info() {
        let (state, _dir) = test_state();
        let params = json!({ "clientInfo": { "name": "Grok", "version": "2.1" } });
        dispatch(&state, "a1", "initialize", Some(json!(1)), Some(params)).await;

        let agent = state.agents.get("a1").await.expect("agent must be registered");
        assert_eq!(agent.name, "Grok", "the name comes off the wire, not a constant");
        assert_eq!(agent.version.as_deref(), Some("2.1"));
    }

    #[tokio::test]
    async fn initialize_without_client_info_still_registers_something_usable() {
        let (state, _dir) = test_state();
        dispatch(&state, "a1", "initialize", Some(json!(1)), None).await;
        let agent = state.agents.get("a1").await.unwrap();
        assert!(!agent.name.is_empty(), "a nameless row is useless in the pane");
    }

    #[tokio::test]
    async fn a_blank_client_name_does_not_become_a_blank_row() {
        let (state, _dir) = test_state();
        let params = json!({ "clientInfo": { "name": "   " } });
        dispatch(&state, "a1", "initialize", Some(json!(1)), Some(params)).await;
        assert!(!state.agents.get("a1").await.unwrap().name.trim().is_empty());
    }

    #[tokio::test]
    async fn notifications_get_no_response() {
        let (state, _dir) = test_state();
        assert!(dispatch(&state, "a1", "notifications/initialized", None, None)
            .await
            .is_none());
    }

    #[tokio::test]
    async fn tools_list_advertises_the_agent_tools_only() {
        let (state, _dir) = test_state();
        let response = dispatch(&state, "a1", "tools/list", Some(json!(1)), None)
            .await
            .unwrap();
        let value = serde_json::to_value(response).unwrap();
        let names: Vec<String> = value["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect();

        assert!(names.contains(&"agent_post".to_string()));
        assert!(names.contains(&"agent_apps_sync".to_string()));
        assert!(names.contains(&"agent_inbox".to_string()));
        assert!(
            !names.iter().any(|n| n.starts_with("hub_")),
            "the session tools are not an agent's business: {names:?}"
        );
    }

    #[tokio::test]
    async fn every_advertised_tool_has_a_valid_schema() {
        let (state, _dir) = test_state();
        let response = dispatch(&state, "a1", "tools/list", Some(json!(1)), None)
            .await
            .unwrap();
        let value = serde_json::to_value(response).unwrap();
        for tool in value["result"]["tools"].as_array().unwrap() {
            assert_eq!(
                tool["inputSchema"]["type"], "object",
                "tool {} has a malformed schema",
                tool["name"]
            );
        }
    }

    #[tokio::test]
    async fn an_unknown_method_is_an_error_not_a_panic() {
        let (state, _dir) = test_state();
        let response = dispatch(&state, "a1", "nope/nope", Some(json!(1)), None)
            .await
            .unwrap();
        let value = serde_json::to_value(response).unwrap();
        assert_eq!(value["error"]["code"], -32601);
    }

    #[tokio::test]
    async fn agent_post_lands_in_the_feed() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;

        let value = call(
            &state,
            "agent_post",
            json!({ "content": "Tauri v3 alpha dropped", "app_id": "x", "type": "info" }),
        )
        .await;
        assert!(value["error"].is_null(), "unexpected error: {value}");

        let posts = state.agent_feed.recent(10).await;
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].content, "Tauri v3 alpha dropped");
        assert_eq!(posts[0].app_id.as_deref(), Some("x"));
        assert_eq!(posts[0].agent_name, "Grok");
    }

    #[tokio::test]
    async fn agent_post_requires_content() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let value = call(&state, "agent_post", json!({ "app_id": "x" })).await;
        assert!(
            value["result"]["isError"].as_bool().unwrap_or(false),
            "a post with no content must be refused: {value}"
        );
        assert!(state.agent_feed.recent(10).await.is_empty());
    }

    #[tokio::test]
    async fn agent_post_refuses_whitespace_as_content() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let value = call(&state, "agent_post", json!({ "content": "   " })).await;
        assert!(value["result"]["isError"].as_bool().unwrap_or(false));
        assert!(state.agent_feed.recent(10).await.is_empty());
    }

    #[tokio::test]
    async fn an_unknown_agent_token_cannot_post() {
        // The route resolved a token to an id, but no agent has completed a
        // handshake under it yet.
        let (state, _dir) = test_state();
        let value = call(&state, "agent_post", json!({ "content": "hello" })).await;
        assert!(value["result"]["isError"].as_bool().unwrap_or(false));
        assert!(state.agent_feed.recent(10).await.is_empty());
    }

    #[tokio::test]
    async fn a_disabled_agent_cannot_post() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        state.agents.set_enabled("a1", false).await;

        let value = call(&state, "agent_post", json!({ "content": "hello" })).await;
        assert!(
            value["result"]["isError"].as_bool().unwrap_or(false),
            "muting an agent must actually stop it: {value}"
        );
        assert!(state.agent_feed.recent(10).await.is_empty());
    }

    #[tokio::test]
    async fn agent_apps_sync_replaces_the_app_list() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;

        call(
            &state,
            "agent_apps_sync",
            json!({ "apps": [
                { "id": "gmail", "label": "Gmail" },
                { "id": "linear", "label": "Linear", "health": "degraded" }
            ]}),
        )
        .await;
        assert_eq!(state.agents.apps("a1").await.len(), 2);

        call(
            &state,
            "agent_apps_sync",
            json!({ "apps": [{ "id": "gmail", "label": "Gmail" }] }),
        )
        .await;
        let apps = state.agents.apps("a1").await;
        assert_eq!(apps.len(), 1, "sync replaces");
        assert_eq!(apps[0].id, "gmail");
    }

    #[tokio::test]
    async fn agent_apps_sync_with_an_empty_list_clears_the_bar() {
        // An agent that has lost every connection must be able to say so.
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        call(&state, "agent_apps_sync", json!({ "apps": [{ "id": "gmail", "label": "Gmail" }] })).await;
        call(&state, "agent_apps_sync", json!({ "apps": [] })).await;
        assert!(state.agents.apps("a1").await.is_empty());
    }

    #[tokio::test]
    async fn agent_inbox_drains_queued_replies() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        state.agent_feed.enqueue_reply("a1", "dig into it".into()).await;

        let value = call(&state, "agent_inbox", json!({})).await;
        let text = value["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("dig into it"), "got {text}");

        // Second call must be empty — the reply was handed over already.
        let again = call(&state, "agent_inbox", json!({})).await;
        let again_text = again["result"]["content"][0]["text"].as_str().unwrap();
        assert!(
            !again_text.contains("dig into it"),
            "replies must not repeat: {again_text}"
        );
    }

    #[tokio::test]
    async fn an_unknown_tool_is_reported_as_a_tool_error() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let value = call(&state, "agent_nope", json!({})).await;
        assert!(value["result"]["isError"].as_bool().unwrap_or(false));
    }

    #[tokio::test]
    async fn tasks_upsert_creates_a_task_with_its_source() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;

        let value = call(&state, "tasks_upsert", json!({
            "external_id": "gmail:thread-1",
            "title": "Send Sarah the Q3 rates breakdown",
            "app_id": "gmail",
            "source_label": "Re: Q3 invoicing"
        })).await;
        assert!(value["result"]["isError"].is_null(), "unexpected error: {value}");

        let tasks = state.tasks.list().await;
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].app_id.as_deref(), Some("gmail"));
        assert_eq!(tasks[0].source_label.as_deref(), Some("Re: Q3 invoicing"));
    }

    #[tokio::test]
    async fn tasks_upsert_is_idempotent_over_the_wire() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let args = json!({ "external_id": "gmail:1", "title": "Reply" });

        call(&state, "tasks_upsert", args.clone()).await;
        call(&state, "tasks_upsert", args).await;

        assert_eq!(state.tasks.list().await.len(), 1, "one thread, one task");
    }

    #[tokio::test]
    async fn tasks_upsert_requires_a_title() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let value = call(&state, "tasks_upsert", json!({ "external_id": "k" })).await;
        assert!(value["result"]["isError"].as_bool().unwrap_or(false));
        assert!(state.tasks.list().await.is_empty());
    }

    #[tokio::test]
    async fn tasks_upsert_accepts_an_iso_due_date_and_rejects_nonsense() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;

        call(&state, "tasks_upsert", json!({
            "external_id": "k1", "title": "Dated", "due": "2026-08-28T09:00:00Z"
        })).await;
        let dated = state.tasks.list().await;
        assert!(dated[0].due.is_some());

        // A due date we cannot parse must not become "now" — a fake deadline is
        // worse than none.
        call(&state, "tasks_upsert", json!({
            "external_id": "k2", "title": "Bad date", "due": "next tuesday"
        })).await;
        let task = state.tasks.list().await.into_iter().find(|t| t.title == "Bad date").unwrap();
        assert!(task.due.is_none());
    }

    #[tokio::test]
    async fn tasks_list_returns_what_the_user_has_done() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let task = state.tasks.create_for_user("Mine".into(), None).await;
        state.tasks.set_done(&task.id, true, crate::models::Actor::User).await;
        state.tasks.add_note(&task.id, crate::models::Actor::User, "my note".into()).await;

        let value = call(&state, "tasks_list", json!({})).await;
        let text = value["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("Mine"));
        assert!(text.contains("my note"), "the agent should see the user's notes");
    }

    #[tokio::test]
    async fn tasks_complete_is_attributed_to_the_agent() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let task = state.tasks.create_for_user("Thing".into(), None).await;

        call(&state, "tasks_complete", json!({ "task_id": task.id })).await;

        let after = state.tasks.get(&task.id).await.unwrap();
        assert!(after.done);
        match after.completed_by {
            Some(crate::models::Actor::Agent { ref name, .. }) => assert_eq!(name, "Grok"),
            other => panic!("expected agent attribution, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn tasks_note_is_attributed_and_does_not_complete_anything() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let task = state.tasks.create_for_user("Thing".into(), None).await;

        call(&state, "tasks_note", json!({ "task_id": task.id, "body": "export finished" })).await;

        let after = state.tasks.get(&task.id).await.unwrap();
        assert_eq!(after.notes.len(), 1);
        assert!(matches!(after.notes[0].author, crate::models::Actor::Agent { .. }));
        assert!(!after.done, "a note is not a completion");
    }

    #[tokio::test]
    async fn task_tools_on_an_unknown_task_report_an_error() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let value = call(&state, "tasks_complete", json!({ "task_id": "nope" })).await;
        assert!(value["result"]["isError"].as_bool().unwrap_or(false));
    }

    #[tokio::test]
    async fn a_muted_agent_cannot_push_tasks() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        state.agents.set_enabled("a1", false).await;
        let value = call(&state, "tasks_upsert", json!({ "title": "Sneaky" })).await;
        assert!(value["result"]["isError"].as_bool().unwrap_or(false));
        assert!(state.tasks.list().await.is_empty());
    }

    #[tokio::test]
    async fn posting_from_an_undeclared_app_still_shows_it_in_the_bar() {
        // Otherwise the post arrives attributed to an app that appears nowhere,
        // and the user cannot filter to or mute it.
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;

        call(&state, "agent_post", json!({ "content": "hi", "app_id": "surprise" })).await;

        let apps = state.agents.apps("a1").await;
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].id, "surprise");
    }

    #[tokio::test]
    async fn a_task_from_an_undeclared_app_also_registers_it() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        call(&state, "tasks_upsert", json!({ "title": "Thing", "app_id": "surprise" })).await;
        assert_eq!(state.agents.apps("a1").await.len(), 1);
    }

    #[tokio::test]
    async fn a_declared_app_is_not_re_added_by_a_post() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        call(&state, "agent_apps_sync", json!({
            "apps": [{ "id": "gmail", "label": "Gmail" }]
        })).await;

        call(&state, "agent_post", json!({ "content": "hi", "app_id": "gmail" })).await;

        let apps = state.agents.apps("a1").await;
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].label, "Gmail", "the declared label survives");
    }

    #[tokio::test]
    async fn a_post_broadcasts_so_the_rail_updates_without_polling() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let mut rx = state.event_tx.subscribe();

        call(&state, "agent_post", json!({ "content": "hello" })).await;

        let event = rx.try_recv().expect("a post must emit a websocket event");
        match event {
            crate::models::WsEvent::AgentPosted { post } => assert_eq!(post.content, "hello"),
            other => panic!("expected AgentPosted, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn camel_case_argument_names_are_accepted() {
        // Hive's HTTP API is camelCase and the tool schemas are snake_case, so
        // an agent sending `appId` is an easy mistake. It used to succeed and
        // quietly drop the provenance and the dedupe key.
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        let value = call(
            &state,
            "tasks_upsert",
            json!({
                "title": "Reply to Q3 invoicing",
                "externalId": "gmail:thread-1",
                "appId": "gmail",
                "sourceLabel": "Re: Q3 invoicing"
            }),
        )
        .await;
        assert!(value["result"]["isError"].is_null(), "{value}");

        let tasks = state.tasks.list().await;
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].external_id.as_deref(), Some("gmail:thread-1"));
        assert_eq!(tasks[0].app_id.as_deref(), Some("gmail"));
        assert_eq!(tasks[0].source_label.as_deref(), Some("Re: Q3 invoicing"));
    }

    #[tokio::test]
    async fn a_declared_spelling_wins_over_its_camel_case_twin() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        call(
            &state,
            "agent_post",
            json!({ "content": "both spellings", "app_id": "gmail", "appId": "slack" }),
        )
        .await;

        let posts = state.agent_feed.recent(10).await;
        assert_eq!(posts[0].app_id.as_deref(), Some("gmail"));
    }

    #[test]
    fn snake_casing_leaves_declared_names_alone() {
        assert_eq!(to_snake_case("app_id"), "app_id");
        assert_eq!(to_snake_case("appId"), "app_id");
        assert_eq!(to_snake_case("sourceLabel"), "source_label");
        assert_eq!(to_snake_case("content"), "content");
    }
}
