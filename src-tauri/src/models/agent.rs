use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::MessageType;

/// An external MCP-speaking agent. Not a Claude Code session: it has no working
/// directory, no terminal to jump to, and no status the user drives.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    /// Taken from the MCP `clientInfo.name` on initialize, so nothing is
    /// hardcoded to a particular vendor. Renameable later, like sessions.
    pub name: String,
    pub version: Option<String>,
    pub connected_at: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    /// False mutes the agent without revoking its token.
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AppHealth {
    #[default]
    Ok,
    Degraded,
    Down,
    /// Restored from disk, with nothing heard from the agent yet this run.
    ///
    /// Declared apps survive a restart so the bar is not empty until every
    /// agent next calls in — but the last health we saw is not news, and
    /// showing it as live would be a claim Hive cannot make.
    Unknown,
}

/// One connected app (Gmail, Linear, …) as declared by an agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApp {
    /// Stable slug the agent chooses. Also the icon lookup key.
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub health: AppHealth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPost {
    pub id: String,
    pub agent_id: String,
    /// Denormalised so the feed can render a post whose agent has since
    /// disconnected, rather than showing an orphan row.
    pub agent_name: String,
    pub app_id: Option<String>,
    pub content: String,
    pub post_type: MessageType,
    pub timestamp: DateTime<Utc>,
    pub read: bool,
}

/// A reply the user typed, waiting for the agent to collect it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReply {
    pub id: String,
    pub agent_id: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_health_serialises_snake_case_for_the_frontend() {
        let json = serde_json::to_string(&AppHealth::Degraded).unwrap();
        assert_eq!(json, "\"degraded\"");
    }

    #[test]
    fn a_post_serialises_camel_case() {
        let post = AgentPost {
            id: "p1".into(),
            agent_id: "a1".into(),
            agent_name: "Grok".into(),
            app_id: Some("gmail".into()),
            content: "Found 2 tasks".into(),
            post_type: MessageType::Info,
            timestamp: Utc::now(),
            read: false,
        };
        let json = serde_json::to_value(&post).unwrap();
        assert!(json.get("agentId").is_some(), "expected camelCase agentId");
        assert!(json.get("appId").is_some(), "expected camelCase appId");
        assert!(json.get("agent_id").is_none(), "must not emit snake_case");
    }

    #[test]
    fn unknown_health_serialises_for_the_frontend() {
        assert_eq!(serde_json::to_string(&AppHealth::Unknown).unwrap(), "\"unknown\"");
    }

    #[test]
    fn an_app_with_no_health_reported_defaults_to_ok() {
        let app: AgentApp = serde_json::from_str(r#"{"id":"gmail","label":"Gmail"}"#).unwrap();
        assert_eq!(app.health, AppHealth::Ok);
    }
}
