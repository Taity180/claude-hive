use tokio::sync::broadcast;

use crate::models::WsEvent;
use crate::state::{SessionRegistry, MessageStore, QuestionStore};

#[derive(Clone)]
pub struct AppState {
    pub sessions: SessionRegistry,
    pub messages: MessageStore,
    pub questions: QuestionStore,
    pub event_tx: broadcast::Sender<WsEvent>,
}

impl AppState {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(256);
        Self {
            sessions: SessionRegistry::new(),
            messages: MessageStore::new(),
            questions: QuestionStore::new(),
            event_tx,
        }
    }
}
