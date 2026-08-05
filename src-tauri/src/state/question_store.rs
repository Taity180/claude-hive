use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;
use uuid::Uuid;

use crate::models::{AskRequest, Question};

/// Why an answer was rejected. The caller turns these into status codes; they
/// exist so the reason survives the trip back to whoever answered.
#[derive(Debug, PartialEq)]
pub enum AnswerError {
    /// No question outstanding for this session.
    NoPendingQuestion,
    /// The answer is for a question that has since been replaced.
    StaleQuestion,
    /// Already answered — first answer wins.
    AlreadyAnswered,
    /// Empty, or not one of the offered options, or several options for a
    /// single-select question.
    InvalidChoice(String),
}

/// One pending question per session, keyed by session id.
///
/// Answered questions are kept rather than dropped: `hub_ask` polls for its
/// own question id after the user clicks, and would otherwise find nothing.
/// They're evicted when the next question replaces them or the session goes.
#[derive(Debug, Clone)]
pub struct QuestionStore {
    questions: Arc<RwLock<HashMap<String, Question>>>,
}

impl QuestionStore {
    pub fn new() -> Self {
        Self {
            questions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn ask(&self, session_id: &str, request: AskRequest) -> Question {
        let question = Question {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            question: request.question,
            options: request.options,
            multi_select: request.multi_select,
            asked_at: Utc::now(),
            answer: None,
            answered_at: None,
        };

        self.questions
            .write()
            .await
            .insert(session_id.to_string(), question.clone());
        question
    }

    /// The session's current question, answered or not.
    pub async fn get(&self, session_id: &str) -> Option<Question> {
        self.questions.read().await.get(session_id).cloned()
    }

    /// The session's current question only while it is still awaiting an answer.
    pub async fn pending(&self, session_id: &str) -> Option<Question> {
        self.get(session_id).await.filter(|q| q.is_pending())
    }

    /// Every unanswered question, for hydrating a dashboard that just opened.
    pub async fn all_pending(&self) -> Vec<Question> {
        self.questions
            .read()
            .await
            .values()
            .filter(|q| q.is_pending())
            .cloned()
            .collect()
    }

    pub async fn answer(
        &self,
        session_id: &str,
        question_id: &str,
        answer: Vec<String>,
    ) -> Result<Question, AnswerError> {
        let mut store = self.questions.write().await;
        let question = store.get_mut(session_id).ok_or(AnswerError::NoPendingQuestion)?;

        if question.id != question_id {
            return Err(AnswerError::StaleQuestion);
        }
        if question.answer.is_some() {
            return Err(AnswerError::AlreadyAnswered);
        }
        if answer.is_empty() {
            return Err(AnswerError::InvalidChoice("answer must not be empty".to_string()));
        }
        if !question.multi_select && answer.len() > 1 {
            return Err(AnswerError::InvalidChoice(
                "this question accepts a single option".to_string(),
            ));
        }
        if let Some(unknown) = answer.iter().find(|a| !question.options.contains(a)) {
            return Err(AnswerError::InvalidChoice(format!(
                "'{}' is not one of the offered options",
                unknown
            )));
        }

        question.answer = Some(answer);
        question.answered_at = Some(Utc::now());
        Ok(question.clone())
    }

    pub async fn remove_session(&self, session_id: &str) {
        self.questions.write().await.remove(session_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask_request(multi_select: bool) -> AskRequest {
        AskRequest {
            question: "JWT or session cookies?".to_string(),
            options: vec!["JWT".to_string(), "Session cookies".to_string()],
            multi_select,
        }
    }

    #[tokio::test]
    async fn ask_stores_a_pending_question() {
        let store = QuestionStore::new();
        let question = store.ask("s1", ask_request(false)).await;

        assert!(question.is_pending());
        assert_eq!(store.pending("s1").await.unwrap().id, question.id);
    }

    #[tokio::test]
    async fn asking_again_replaces_the_previous_question() {
        let store = QuestionStore::new();
        let first = store.ask("s1", ask_request(false)).await;
        let second = store.ask("s1", ask_request(false)).await;

        assert_ne!(first.id, second.id);
        assert_eq!(store.pending("s1").await.unwrap().id, second.id);
    }

    #[tokio::test]
    async fn answer_records_the_choice_and_clears_pending() {
        let store = QuestionStore::new();
        let question = store.ask("s1", ask_request(false)).await;

        let answered = store
            .answer("s1", &question.id, vec!["JWT".to_string()])
            .await
            .unwrap();

        assert_eq!(answered.answer, Some(vec!["JWT".to_string()]));
        assert!(answered.answered_at.is_some());
        assert!(store.pending("s1").await.is_none());
        // Still retrievable so hub_ask's poll can collect it.
        assert!(store.get("s1").await.unwrap().answer.is_some());
    }

    #[tokio::test]
    async fn answer_accepts_several_options_when_multi_select() {
        let store = QuestionStore::new();
        let question = store.ask("s1", ask_request(true)).await;

        let answered = store
            .answer(
                "s1",
                &question.id,
                vec!["JWT".to_string(), "Session cookies".to_string()],
            )
            .await
            .unwrap();

        assert_eq!(answered.answer.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn answer_rejects_several_options_when_single_select() {
        let store = QuestionStore::new();
        let question = store.ask("s1", ask_request(false)).await;

        let result = store
            .answer(
                "s1",
                &question.id,
                vec!["JWT".to_string(), "Session cookies".to_string()],
            )
            .await;

        assert!(matches!(result, Err(AnswerError::InvalidChoice(_))));
    }

    #[tokio::test]
    async fn answer_rejects_an_option_that_was_never_offered() {
        let store = QuestionStore::new();
        let question = store.ask("s1", ask_request(false)).await;

        let result = store
            .answer("s1", &question.id, vec!["OAuth".to_string()])
            .await;

        assert!(matches!(result, Err(AnswerError::InvalidChoice(_))));
    }

    #[tokio::test]
    async fn answer_rejects_an_empty_choice() {
        let store = QuestionStore::new();
        let question = store.ask("s1", ask_request(false)).await;

        let result = store.answer("s1", &question.id, vec![]).await;

        assert!(matches!(result, Err(AnswerError::InvalidChoice(_))));
    }

    #[tokio::test]
    async fn answer_rejects_a_question_that_has_been_replaced() {
        let store = QuestionStore::new();
        let stale = store.ask("s1", ask_request(false)).await;
        store.ask("s1", ask_request(false)).await;

        let result = store.answer("s1", &stale.id, vec!["JWT".to_string()]).await;

        assert_eq!(result.unwrap_err(), AnswerError::StaleQuestion);
    }

    #[tokio::test]
    async fn second_answer_loses_to_the_first() {
        let store = QuestionStore::new();
        let question = store.ask("s1", ask_request(false)).await;
        store
            .answer("s1", &question.id, vec!["JWT".to_string()])
            .await
            .unwrap();

        let result = store
            .answer("s1", &question.id, vec!["Session cookies".to_string()])
            .await;

        assert_eq!(result.unwrap_err(), AnswerError::AlreadyAnswered);
    }

    #[tokio::test]
    async fn answer_reports_when_nothing_is_outstanding() {
        let store = QuestionStore::new();
        let result = store.answer("s1", "whatever", vec!["JWT".to_string()]).await;

        assert_eq!(result.unwrap_err(), AnswerError::NoPendingQuestion);
    }

    #[tokio::test]
    async fn all_pending_skips_answered_questions() {
        let store = QuestionStore::new();
        let answered = store.ask("s1", ask_request(false)).await;
        store.ask("s2", ask_request(false)).await;
        store
            .answer("s1", &answered.id, vec!["JWT".to_string()])
            .await
            .unwrap();

        let pending = store.all_pending().await;
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].session_id, "s2");
    }

    #[tokio::test]
    async fn remove_session_drops_its_question() {
        let store = QuestionStore::new();
        store.ask("s1", ask_request(false)).await;
        store.remove_session("s1").await;

        assert!(store.get("s1").await.is_none());
    }
}
