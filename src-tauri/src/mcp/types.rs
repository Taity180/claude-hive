use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

impl JsonRpcResponse {
    pub fn success(id: Option<Value>, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(id: Option<Value>, code: i32, message: String) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError { code, message }),
        }
    }
}

pub const MCP_TOOLS: &[ToolDef] = &[
    ToolDef {
        name: "hub_send_message",
        description: "REQUIRED throughout every task. Post a progress message to the Claude Hive feed, which is where the user follows your work — they are usually not watching this terminal. Send one when starting a task, on each meaningful step, when you hit a problem, and when you finish: at least 1 per 1-3 tool calls, and never zero for a user request.",
        schema: r#"{
            "type": "object",
            "properties": {
                "message": { "type": "string", "description": "The message content" },
                "type": { "type": "string", "enum": ["info", "question", "completion", "error"], "default": "info" }
            },
            "required": ["message"]
        }"#,
    },
    ToolDef {
        name: "hub_set_status",
        description: "REQUIRED on every state change. Update this session's status pill on the Claude Hive dashboard so the user can see at a glance which sessions are working and which need them. Call it before reading, editing, or running commands, when you start planning, when you become blocked, and when you finish. Always include a specific `detail`.",
        schema: r#"{
            "type": "object",
            "properties": {
                "status": { "type": "string", "enum": ["running", "waiting_for_input", "thinking", "error", "idle"] },
                "detail": { "type": "string", "description": "Optional short description" }
            },
            "required": ["status"]
        }"#,
    },
    ToolDef {
        name: "hub_get_messages",
        description: "Retrieve messages sent to this session from the hub (user replies typed into the dashboard, broadcasts from other sessions). Check at session start, between tasks, and whenever you are idle — the user may have queued instructions you have not seen.",
        schema: r#"{
            "type": "object",
            "properties": {
                "since": { "type": "string", "description": "ISO timestamp, get messages after this time" },
                "unread_only": { "type": "boolean", "default": true }
            }
        }"#,
    },
    ToolDef {
        name: "hub_notify",
        description: "REQUIRED at least once per user request, normally on completion. Fires a native desktop notification, the only signal that reaches the user when they are on a different virtual desktop. Also use it for a blocking error or an urgent question. Do not use it for routine mid-task progress — that is hub_send_message.",
        schema: r#"{
            "type": "object",
            "properties": {
                "title": { "type": "string" },
                "body": { "type": "string" },
                "priority": { "type": "string", "enum": ["low", "normal", "high"], "default": "normal" }
            },
            "required": ["title", "body"]
        }"#,
    },
    ToolDef {
        name: "hub_ask",
        description: "Ask the user a multiple-choice question on the Claude Hive dashboard and WAIT for their answer — this call blocks until they click an option, then returns their choice. Use it instead of asking in the terminal whenever you need a decision, because the user is usually on another virtual desktop where terminal output is invisible to them. Give 2-8 concrete options. Returns 'No answer' if they don't respond before the timeout, in which case fall back to asking in the terminal.",
        schema: r#"{
            "type": "object",
            "properties": {
                "question": { "type": "string", "description": "The question, phrased so the options make sense as answers" },
                "options": {
                    "type": "array",
                    "items": { "type": "string" },
                    "minItems": 2,
                    "maxItems": 8,
                    "description": "Short, concrete choices. For a yes/no question pass exactly two."
                },
                "multi_select": { "type": "boolean", "default": false, "description": "Let the user pick more than one option" },
                "timeout_seconds": { "type": "number", "default": 300, "description": "How long to wait before giving up (10-1800)" }
            },
            "required": ["question", "options"]
        }"#,
    },
    ToolDef {
        name: "hub_broadcast",
        description: "Send a message to ALL other connected Claude sessions for cross-session coordination.",
        schema: r#"{
            "type": "object",
            "properties": {
                "message": { "type": "string" }
            },
            "required": ["message"]
        }"#,
    },
];

pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    pub schema: &'static str,
}
