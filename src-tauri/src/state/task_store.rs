use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use tokio::sync::RwLock;

use crate::models::{Actor, Task, TaskNote};

const FILE_NAME: &str = "tasks.json";

/// Tasks, persisted to disk.
///
/// The first store in Hive that survives a restart. Writes happen on every
/// mutation rather than on exit: a task list that empties when the app crashes
/// is worse than no task list.
#[derive(Debug, Clone)]
pub struct TaskStore {
    tasks: Arc<RwLock<HashMap<String, Task>>>,
    path: Arc<PathBuf>,
}

impl TaskStore {
    pub fn load_or_create(dir: &Path) -> Self {
        let path = dir.join(FILE_NAME);
        let loaded: HashMap<String, Task> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<Task>>(&raw).ok())
            .map(|list| list.into_iter().map(|t| (t.id.clone(), t)).collect())
            // Unreadable or corrupt: start empty rather than refuse to boot.
            .unwrap_or_default();

        Self {
            tasks: Arc::new(RwLock::new(loaded)),
            path: Arc::new(path),
        }
    }

    /// Write the whole file. Called after every mutation.
    ///
    /// Rewriting everything is fine at this scale — a task list is tens of
    /// rows, not thousands — and it avoids the partial-write problems an
    /// append-only format would bring.
    async fn persist(&self) {
        let snapshot: Vec<Task> = self.tasks.read().await.values().cloned().collect();
        let json = match serde_json::to_string_pretty(&snapshot) {
            Ok(json) => json,
            Err(e) => {
                tracing::error!("tasks: could not serialise: {e}");
                return;
            }
        };
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(self.path.as_path(), json) {
            // Losing the write is bad, but taking the dashboard down with it is
            // worse. The in-memory list stays correct for this session.
            tracing::error!("tasks: could not write {}: {e}", self.path.display());
        }
    }

    /// Create or update a task an agent pushed.
    ///
    /// Dedupes on `(agent_id, external_id)`. Two agents watching the same inbox
    /// are not the same source of truth, so the agent is part of the key.
    ///
    /// An update deliberately touches only the agent-owned fields: the title,
    /// source and due date. Completion state and notes are the user's, and an
    /// agent re-pushing must never un-tick a box or wipe a note.
    pub async fn upsert_from_agent(
        &self,
        agent_id: &str,
        external_id: Option<String>,
        title: String,
        app_id: Option<String>,
        source_label: Option<String>,
        due: Option<DateTime<Utc>>,
    ) -> Task {
        let task = {
            let mut tasks = self.tasks.write().await;

            let existing_id = external_id.as_ref().and_then(|key| {
                tasks
                    .values()
                    .find(|t| {
                        t.agent_id.as_deref() == Some(agent_id)
                            && t.external_id.as_deref() == Some(key.as_str())
                    })
                    .map(|t| t.id.clone())
            });

            match existing_id {
                Some(id) => {
                    let task = tasks.get_mut(&id).expect("just found it");
                    task.title = title;
                    task.app_id = app_id;
                    task.source_label = source_label;
                    task.due = due;
                    task.updated_at = Utc::now();
                    task.clone()
                }
                None => {
                    let mut task = Task::new(title);
                    task.external_id = external_id;
                    task.agent_id = Some(agent_id.to_string());
                    task.app_id = app_id;
                    task.source_label = source_label;
                    task.due = due;
                    tasks.insert(task.id.clone(), task.clone());
                    task
                }
            }
        };

        self.persist().await;
        task
    }

    pub async fn create_for_user(&self, title: String, due: Option<DateTime<Utc>>) -> Task {
        let mut task = Task::new(title);
        task.due = due;
        self.tasks
            .write()
            .await
            .insert(task.id.clone(), task.clone());
        self.persist().await;
        task
    }

    pub async fn list(&self) -> Vec<Task> {
        self.tasks.read().await.values().cloned().collect()
    }

    pub async fn get(&self, id: &str) -> Option<Task> {
        self.tasks.read().await.get(id).cloned()
    }

    /// Tick or un-tick, recording who did it.
    ///
    /// Reopening clears the attribution: a task that is not done was not
    /// completed by anybody, and leaving a stale completer would misreport it.
    pub async fn set_done(&self, id: &str, done: bool, by: Actor) -> bool {
        {
            let mut tasks = self.tasks.write().await;
            let Some(task) = tasks.get_mut(id) else {
                return false;
            };
            task.done = done;
            task.completed_by = if done { Some(by) } else { None };
            task.completed_at = if done { Some(Utc::now()) } else { None };
            task.updated_at = Utc::now();
        }
        self.persist().await;
        true
    }

    pub async fn add_note(&self, id: &str, author: Actor, body: String) -> bool {
        {
            let mut tasks = self.tasks.write().await;
            let Some(task) = tasks.get_mut(id) else {
                return false;
            };
            task.notes.push(TaskNote::new(author, body));
            task.updated_at = Utc::now();
        }
        self.persist().await;
        true
    }

    pub async fn remove(&self, id: &str) -> bool {
        let removed = self.tasks.write().await.remove(id).is_some();
        if removed {
            self.persist().await;
        }
        removed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (TaskStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        (TaskStore::load_or_create(dir.path()), dir)
    }

    fn grok() -> Actor {
        Actor::Agent { id: "a1".into(), name: "Grok".into() }
    }

    #[tokio::test]
    async fn the_same_external_id_updates_instead_of_duplicating() {
        // THE test for this feature. An agent re-reading the same email thread
        // must update one task, not add another every run.
        let (store, _dir) = store();
        store
            .upsert_from_agent("a1", Some("gmail:thread-1".into()), "Reply to Sarah".into(), None, None, None)
            .await;
        store
            .upsert_from_agent("a1", Some("gmail:thread-1".into()), "Reply to Sarah about Q3".into(), None, None, None)
            .await;

        let tasks = store.list().await;
        assert_eq!(tasks.len(), 1, "one thread, one task");
        assert_eq!(tasks[0].title, "Reply to Sarah about Q3", "the newer title wins");
    }

    #[tokio::test]
    async fn different_external_ids_are_different_tasks() {
        let (store, _dir) = store();
        store.upsert_from_agent("a1", Some("gmail:1".into()), "One".into(), None, None, None).await;
        store.upsert_from_agent("a1", Some("gmail:2".into()), "Two".into(), None, None, None).await;
        assert_eq!(store.list().await.len(), 2);
    }

    #[tokio::test]
    async fn the_same_external_id_from_a_different_agent_is_a_different_task() {
        // Two agents watching the same inbox are not the same source of truth.
        let (store, _dir) = store();
        store.upsert_from_agent("a1", Some("gmail:1".into()), "From Grok".into(), None, None, None).await;
        store.upsert_from_agent("a2", Some("gmail:1".into()), "From Ops".into(), None, None, None).await;
        assert_eq!(store.list().await.len(), 2);
    }

    #[tokio::test]
    async fn a_push_without_an_external_id_cannot_dedupe_and_says_so() {
        let (store, _dir) = store();
        store.upsert_from_agent("a1", None, "Untracked".into(), None, None, None).await;
        store.upsert_from_agent("a1", None, "Untracked".into(), None, None, None).await;
        // Nothing to key on, so two tasks. The tool description tells agents to
        // always send one; this documents what happens when they do not.
        assert_eq!(store.list().await.len(), 2);
    }

    #[tokio::test]
    async fn an_upsert_preserves_the_users_work() {
        // An agent re-pushing must not un-tick a box or wipe a note.
        let (store, _dir) = store();
        let task = store
            .upsert_from_agent("a1", Some("k".into()), "Thing".into(), None, None, None)
            .await;
        store.set_done(&task.id, true, Actor::User).await;
        store.add_note(&task.id, Actor::User, "my note".into()).await;

        store.upsert_from_agent("a1", Some("k".into()), "Thing renamed".into(), None, None, None).await;

        let after = store.get(&task.id).await.unwrap();
        assert!(after.done, "completion survives a re-push");
        assert_eq!(after.notes.len(), 1, "notes survive a re-push");
        assert_eq!(after.title, "Thing renamed");
    }

    #[tokio::test]
    async fn completion_records_who_did_it() {
        let (store, _dir) = store();
        let a = store.create_for_user("Mine".into(), None).await;
        let b = store.create_for_user("Theirs".into(), None).await;

        store.set_done(&a.id, true, Actor::User).await;
        store.set_done(&b.id, true, grok()).await;

        assert!(matches!(store.get(&a.id).await.unwrap().completed_by, Some(Actor::User)));
        assert!(matches!(
            store.get(&b.id).await.unwrap().completed_by,
            Some(Actor::Agent { .. })
        ));
    }

    #[tokio::test]
    async fn unticking_clears_the_attribution() {
        let (store, _dir) = store();
        let task = store.create_for_user("Thing".into(), None).await;
        store.set_done(&task.id, true, grok()).await;
        store.set_done(&task.id, false, Actor::User).await;

        let after = store.get(&task.id).await.unwrap();
        assert!(!after.done);
        assert!(after.completed_by.is_none(), "a reopened task has no completer");
        assert!(after.completed_at.is_none());
    }

    #[tokio::test]
    async fn notes_keep_their_order_and_authors() {
        let (store, _dir) = store();
        let task = store.create_for_user("Thing".into(), None).await;
        store.add_note(&task.id, Actor::User, "mine".into()).await;
        store.add_note(&task.id, grok(), "theirs".into()).await;

        let notes = store.get(&task.id).await.unwrap().notes;
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].body, "mine", "oldest first");
        assert!(matches!(notes[1].author, Actor::Agent { .. }));
    }

    #[tokio::test]
    async fn everything_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let first = TaskStore::load_or_create(dir.path());
        let task = first
            .upsert_from_agent("a1", Some("k".into()), "Persisted".into(), None, None, None)
            .await;
        first.add_note(&task.id, Actor::User, "note".into()).await;
        first.set_done(&task.id, true, Actor::User).await;

        // Write-through, not write-on-exit: a crash must not cost the day's work.
        let second = TaskStore::load_or_create(dir.path());
        let reloaded = second.get(&task.id).await.expect("task must survive");
        assert!(reloaded.done);
        assert_eq!(reloaded.notes.len(), 1);
    }

    #[tokio::test]
    async fn a_corrupt_file_starts_empty_rather_than_refusing_to_boot() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("tasks.json"), "{not json").unwrap();
        let store = TaskStore::load_or_create(dir.path());
        assert!(store.list().await.is_empty());
    }

    #[tokio::test]
    async fn removing_a_task_is_permanent() {
        let (store, _dir) = store();
        let task = store.create_for_user("Thing".into(), None).await;
        assert!(store.remove(&task.id).await);
        assert!(store.get(&task.id).await.is_none());
        assert!(!store.remove(&task.id).await, "removing twice reports false");
    }

    #[tokio::test]
    async fn operations_on_an_unknown_id_are_not_panics() {
        let (store, _dir) = store();
        assert!(store.get("nope").await.is_none());
        assert!(!store.set_done("nope", true, Actor::User).await);
        assert!(!store.add_note("nope", Actor::User, "x".into()).await);
    }
}
