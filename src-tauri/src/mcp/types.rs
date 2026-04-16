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
        description: "Send a message to the Claude Hive chat feed. Use this to report progress, ask questions, or share completions.",
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
        description: "Update this session's status indicator on the Claude Hive dashboard.",
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
        description: "Retrieve messages sent to this session from the hub (user replies, broadcasts from other sessions).",
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
        description: "Trigger a desktop notification on the user's machine.",
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
