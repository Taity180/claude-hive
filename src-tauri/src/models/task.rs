use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Who did something — the user, or a named agent.
///
/// Tagged so the frontend can distinguish them. An agent completing the user's
/// work silently would be a trust problem; the label is the whole point.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Actor {
    User,
    Agent { id: String, name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskNote {
    pub id: String,
    pub author: Actor,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

impl TaskNote {
    pub fn new(author: Actor, body: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            author,
            body,
            created_at: Utc::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    /// Stable key the pushing agent chooses, e.g. "gmail:thread-abc". The
    /// upsert dedupes on this: without it, an agent re-reading the same email
    /// thread creates a new task every run.
    #[serde(default)]
    pub external_id: Option<String>,
    /// None for a task the user typed.
    #[serde(default)]
    pub agent_id: Option<String>,
    pub title: String,
    /// Slug of the app it came from, for the provenance chip and its icon.
    #[serde(default)]
    pub app_id: Option<String>,
    /// What it came from, e.g. "Re: Q3 invoicing".
    #[serde(default)]
    pub source_label: Option<String>,
    /// Genuinely optional: an agent finding "reply to Sarah" has no deadline to
    /// read, and inventing one would put a fake deadline on the user's list.
    #[serde(default)]
    pub due: Option<DateTime<Utc>>,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub completed_by: Option<Actor>,
    #[serde(default)]
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub notes: Vec<TaskNote>,
    #[serde(default = "Utc::now")]
    pub created_at: DateTime<Utc>,
    #[serde(default = "Utc::now")]
    pub updated_at: DateTime<Utc>,
}

impl Task {
    pub fn new(title: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            external_id: None,
            agent_id: None,
            title,
            app_id: None,
            source_label: None,
            due: None,
            done: false,
            completed_by: None,
            completed_at: None,
            notes: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_actor_says_which_kind_it_is() {
        // The frontend has to tell "you ticked this" from "an agent ticked
        // this", so the tag is load-bearing, not decoration.
        let user = serde_json::to_value(Actor::User).unwrap();
        assert_eq!(user["kind"], "user");

        let agent = serde_json::to_value(Actor::Agent {
            id: "a1".into(),
            name: "Grok".into(),
        })
        .unwrap();
        assert_eq!(agent["kind"], "agent");
        assert_eq!(agent["name"], "Grok");
    }

    #[test]
    fn a_task_serialises_camel_case_with_no_notes_by_default() {
        let task: Task = serde_json::from_str(r#"{"id":"t1","title":"Reply to Sarah"}"#).unwrap();
        assert_eq!(task.title, "Reply to Sarah");
        assert!(task.notes.is_empty());
        assert!(!task.done);
        assert!(
            task.due.is_none(),
            "no due date is a real state, not a default of now"
        );

        let json = serde_json::to_value(&task).unwrap();
        assert!(json.get("externalId").is_some());
        assert!(json.get("external_id").is_none());
    }

    #[test]
    fn a_note_carries_its_author() {
        let note = TaskNote::new(Actor::User, "waiting on the export".into());
        assert!(matches!(note.author, Actor::User));
        assert!(!note.id.is_empty());
    }
}
