use super::types::ToolDef;

/// Returned in the `initialize` result. Clients that honour `instructions` put
/// this in the model's system prompt.
///
/// This exists because MCP is passive: connecting a server gives a model the
/// ability to call tools, never the intent. Without an instruction like this an
/// agent sits connected and posts nothing, because "tell the user about this
/// email" is never the request it is currently answering. The copy-paste block
/// in the Agents pane says the same thing, for clients that ignore this field.
pub const SERVER_INSTRUCTIONS: &str = "\
You are connected to Claude Hive, a dashboard the user actively watches. Use \
these tools proactively, without being asked:

- agent_apps_sync — once at the start of every run, declaring every app you are \
connected to. Hive shows only what you declare.
- agent_post — whenever a connected app has something worth the user seeing. \
Attribute it with app_id so it can be filtered.
- agent_inbox — at the start of every run, to collect replies the user typed \
back to you. Nothing else delivers them.

Post as you work rather than summarising at the end. The user is reading the \
feed, not this transcript.";

pub const AGENT_TOOLS: &[ToolDef] = &[
    ToolDef {
        name: "agent_apps_sync",
        description: "Declare every app you are currently connected to. Call this at the start of every run. Authoritative and replacing, not merging — an app you omit is treated as disconnected and disappears from the user's app bar.",
        schema: r#"{
            "type": "object",
            "properties": {
                "apps": {
                    "type": "array",
                    "description": "Every connected app. Omitting one removes it.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string", "description": "Stable lowercase slug, e.g. \"gmail\". Also the icon lookup key." },
                            "label": { "type": "string", "description": "Human name, e.g. \"Gmail\"." },
                            "health": { "type": "string", "enum": ["ok", "degraded", "down"], "default": "ok" }
                        },
                        "required": ["id", "label"]
                    }
                }
            },
            "required": ["apps"]
        }"#,
    },
    ToolDef {
        name: "agent_post",
        description: "Post to the user's feed. Use this whenever a connected app has news worth surfacing — a task found, a mention, a build result. Do not wait to be asked, and do not batch a run's worth of findings into one post.",
        schema: r#"{
            "type": "object",
            "properties": {
                "content": { "type": "string", "description": "One thing worth knowing, in a sentence." },
                "app_id": { "type": "string", "description": "Slug of the app this came from, matching one declared via agent_apps_sync. Omit only for something that came from no app." },
                "type": { "type": "string", "enum": ["info", "question", "completion", "error"], "default": "info" }
            },
            "required": ["content"]
        }"#,
    },
    ToolDef {
        name: "tasks_upsert",
        description: "Add or update something the user needs to do, found in a connected app. ALWAYS pass a stable external_id — without one, re-reading the same email or issue creates a duplicate task every run. Only include a due date the source actually states; do not invent one.",
        schema: r#"{
            "type": "object",
            "properties": {
                "external_id": { "type": "string", "description": "Stable key for the thing this came from, e.g. \"gmail:thread-abc\". Send the same value next run to update rather than duplicate." },
                "title": { "type": "string", "description": "What the user has to do, as an imperative." },
                "app_id": { "type": "string", "description": "Slug of the app it came from, matching agent_apps_sync." },
                "source_label": { "type": "string", "description": "What it came from, e.g. \"Re: Q3 invoicing\". Shown to the user as provenance." },
                "due": { "type": "string", "description": "ISO-8601 timestamp. Omit unless the source states a deadline." }
            },
            "required": ["title"]
        }"#,
    },
    ToolDef {
        name: "tasks_list",
        description: "Read the user's tasks, including which are done and any notes they have written. Call before pushing, to see what they have already dealt with.",
        schema: r#"{
            "type": "object",
            "properties": {
                "include_done": { "type": "boolean", "default": true }
            }
        }"#,
    },
    ToolDef {
        name: "tasks_complete",
        description: "Mark a task done. Only when you have actually done it or confirmed it is done — the user sees your name against it, so a wrong completion is worse than none.",
        schema: r#"{
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "done": { "type": "boolean", "default": true }
            },
            "required": ["task_id"]
        }"#,
    },
    ToolDef {
        name: "tasks_note",
        description: "Add context to a task without changing whether it is done. Use for what you found out, e.g. that a blocker has cleared.",
        schema: r#"{
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "body": { "type": "string" }
            },
            "required": ["task_id", "body"]
        }"#,
    },
    ToolDef {
        name: "agent_inbox",
        description: "Collect replies the user typed back to you in Hive, and clear them. Call at the start of every run. This is the only way their replies reach you — Hive cannot push to you, so an uncollected reply waits indefinitely. Each reply is delivered once.",
        schema: r#"{
            "type": "object",
            "properties": {}
        }"#,
    },
];
