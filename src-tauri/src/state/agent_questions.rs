use std::collections::HashMap;
use std::sync::Arc;

use chrono::Utc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::models::AgentQuestion;

/// Why an answer was rejected.
#[derive(Debug, PartialEq)]
pub enum AgentAnswerError {
    /// No such question, or it belongs to another agent.
    Unknown,
    /// Already answered — first answer wins, as it does for sessions.
    AlreadyAnswered,
    /// Not one of the offered options.
    NotAnOption(String),
}

/// Questions agents have asked the user.
///
/// One pending question per agent, keyed by agent id — the same rule sessions
/// follow, for the same reason: a second question before the first is answered
/// means the agent has moved on, and showing both would ask the user to answer
/// something already abandoned.
///
/// Answered questions are kept until replaced, because the asking agent polls
/// for its own question id after the click and would otherwise find nothing.
///
/// Not persisted. A question is a live conversation: an agent that has been
/// restarted is no longer waiting for the answer, so restoring one would
/// present the user with a choice that can no longer reach anybody.
#[derive(Debug, Clone, Default)]
pub struct AgentQuestionStore {
    questions: Arc<RwLock<HashMap<String, AgentQuestion>>>,
}

impl AgentQuestionStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn ask(
        &self,
        agent_id: &str,
        agent_name: &str,
        app_id: Option<String>,
        question: String,
        options: Vec<String>,
    ) -> AgentQuestion {
        let asked = AgentQuestion {
            id: Uuid::new_v4().to_string(),
            agent_id: agent_id.to_string(),
            agent_name: agent_name.to_string(),
            app_id,
            question,
            options,
            asked_at: Utc::now(),
            answer: None,
            answered_at: None,
        };

        self.questions
            .write()
            .await
            .insert(agent_id.to_string(), asked.clone());
        asked
    }

    /// The agent's current question, answered or not.
    pub async fn get(&self, agent_id: &str) -> Option<AgentQuestion> {
        self.questions.read().await.get(agent_id).cloned()
    }

    /// Every unanswered question, for hydrating a rail that just opened.
    pub async fn all_pending(&self) -> Vec<AgentQuestion> {
        self.questions
            .read()
            .await
            .values()
            .filter(|q| q.is_pending())
            .cloned()
            .collect()
    }

    /// Record the user's choice.
    ///
    /// The question id is required rather than just the agent: by the time a
    /// click lands the agent may have asked something else, and answering
    /// whatever is current would attribute the choice to the wrong question.
    pub async fn answer(
        &self,
        question_id: &str,
        choice: &str,
    ) -> Result<AgentQuestion, AgentAnswerError> {
        let mut store = self.questions.write().await;
        let question = store
            .values_mut()
            .find(|q| q.id == question_id)
            .ok_or(AgentAnswerError::Unknown)?;

        if question.answer.is_some() {
            return Err(AgentAnswerError::AlreadyAnswered);
        }
        if !question.options.iter().any(|o| o == choice) {
            return Err(AgentAnswerError::NotAnOption(choice.to_string()));
        }

        question.answer = Some(choice.to_string());
        question.answered_at = Some(Utc::now());
        Ok(question.clone())
    }

    /// Drop an agent's question. Used when the agent is forgotten.
    pub async fn remove_agent(&self, agent_id: &str) {
        self.questions.write().await.remove(agent_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn asked(store: &AgentQuestionStore) -> AgentQuestion {
        store
            .ask(
                "a1",
                "Grok Bot",
                Some("gmail".into()),
                "Reply to Sarah now?".into(),
                vec!["Yes".into(), "Later".into()],
            )
            .await
    }

    #[tokio::test]
    async fn asking_stores_a_pending_question() {
        let store = AgentQuestionStore::new();
        let q = asked(&store).await;

        assert!(q.is_pending());
        assert_eq!(store.get("a1").await.unwrap().id, q.id);
        assert_eq!(store.all_pending().await.len(), 1);
    }

    #[tokio::test]
    async fn answering_records_the_choice() {
        let store = AgentQuestionStore::new();
        let q = asked(&store).await;

        let answered = store.answer(&q.id, "Later").await.unwrap();
        assert_eq!(answered.answer.as_deref(), Some("Later"));
        assert!(answered.answered_at.is_some());
        assert!(store.all_pending().await.is_empty());
    }

    #[tokio::test]
    async fn an_answered_question_is_still_readable_by_the_agent() {
        // The agent polls for its own question after the click; dropping it on
        // answer would leave it waiting forever.
        let store = AgentQuestionStore::new();
        let q = asked(&store).await;
        store.answer(&q.id, "Yes").await.unwrap();

        assert_eq!(store.get("a1").await.unwrap().answer.as_deref(), Some("Yes"));
    }

    #[tokio::test]
    async fn the_first_answer_wins() {
        let store = AgentQuestionStore::new();
        let q = asked(&store).await;
        store.answer(&q.id, "Yes").await.unwrap();

        assert_eq!(
            store.answer(&q.id, "Later").await.unwrap_err(),
            AgentAnswerError::AlreadyAnswered
        );
        assert_eq!(store.get("a1").await.unwrap().answer.as_deref(), Some("Yes"));
    }

    #[tokio::test]
    async fn an_answer_must_be_one_of_the_options() {
        let store = AgentQuestionStore::new();
        let q = asked(&store).await;

        assert_eq!(
            store.answer(&q.id, "Maybe").await.unwrap_err(),
            AgentAnswerError::NotAnOption("Maybe".into())
        );
        assert!(store.get("a1").await.unwrap().is_pending());
    }

    #[tokio::test]
    async fn an_unknown_question_id_is_an_error_not_a_wrong_answer() {
        // A click can land after the agent has replaced its question. Answering
        // whatever is current would attribute the choice to the wrong question.
        let store = AgentQuestionStore::new();
        asked(&store).await;
        assert_eq!(
            store.answer("nope", "Yes").await.unwrap_err(),
            AgentAnswerError::Unknown
        );
    }

    #[tokio::test]
    async fn a_second_question_replaces_the_first() {
        let store = AgentQuestionStore::new();
        let first = asked(&store).await;
        let second = store
            .ask("a1", "Grok Bot", None, "Still there?".into(), vec!["Yes".into()])
            .await;

        assert_eq!(store.all_pending().await.len(), 1, "one question per agent");
        assert_eq!(store.get("a1").await.unwrap().id, second.id);
        assert_eq!(
            store.answer(&first.id, "Yes").await.unwrap_err(),
            AgentAnswerError::Unknown,
            "the replaced question is no longer answerable"
        );
    }

    #[tokio::test]
    async fn two_agents_may_each_have_a_question() {
        let store = AgentQuestionStore::new();
        asked(&store).await;
        store
            .ask("a2", "Ops", None, "Deploy?".into(), vec!["Yes".into()])
            .await;
        assert_eq!(store.all_pending().await.len(), 2);
    }

    #[tokio::test]
    async fn removing_an_agent_drops_its_question() {
        let store = AgentQuestionStore::new();
        asked(&store).await;
        store.remove_agent("a1").await;
        assert!(store.get("a1").await.is_none());
    }
}
