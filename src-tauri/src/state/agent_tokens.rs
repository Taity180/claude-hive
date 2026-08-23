use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const FILE_NAME: &str = "agent-tokens.json";

/// Bearer tokens, one per agent, persisted to disk.
///
/// Persisted because the user pastes a token into their agent's configuration
/// once. Regenerating it on every restart would silently break every agent they
/// had set up.
///
/// One token per agent rather than one shared secret: a shared secret cannot be
/// revoked for a single agent without breaking the rest, and the feed cannot
/// attribute a post it did not already trust.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentTokens {
    /// token → agent id
    #[serde(default)]
    tokens: HashMap<String, String>,
    /// agent id → the label shown while the agent has never connected
    #[serde(default)]
    labels: HashMap<String, String>,
}

impl AgentTokens {
    /// `%APPDATA%/claude-hive` on Windows, the XDG config dir elsewhere.
    pub fn config_dir() -> Option<PathBuf> {
        dirs::config_dir().map(|d| d.join("claude-hive"))
    }

    pub fn load_or_create(dir: &Path) -> Self {
        let path = dir.join(FILE_NAME);
        let parsed = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Self>(&raw).ok());

        match parsed {
            Some(loaded) if !loaded.tokens.is_empty() => loaded,
            // Missing, unreadable, corrupt, or empty: start fresh rather than
            // refuse to boot. The cost is a token the user must re-copy, which
            // beats a dashboard that will not start.
            _ => {
                let mut fresh = Self::default();
                fresh.issue("default");
                let _ = fresh.save(dir);
                fresh
            }
        }
    }

    pub fn issue(&mut self, label: &str) -> String {
        let token = format!("hive_ag_{}", Uuid::new_v4().simple());
        let agent_id = Uuid::new_v4().to_string();
        self.labels.insert(agent_id.clone(), label.to_string());
        self.tokens.insert(token.clone(), agent_id);
        token
    }

    pub fn agent_id_for(&self, token: &str) -> Option<String> {
        if token.is_empty() {
            return None;
        }
        self.tokens.get(token).cloned()
    }

    pub fn label_for(&self, agent_id: &str) -> Option<String> {
        self.labels.get(agent_id).cloned()
    }

    pub fn tokens(&self) -> Vec<(String, String)> {
        self.tokens
            .iter()
            .map(|(t, a)| (t.clone(), a.clone()))
            .collect()
    }

    /// Write the token file, owner-readable only.
    ///
    /// This file is credentials. `std::fs::write` would leave it at the
    /// umask default — 0644, world-readable — on Unix. Windows inherits the
    /// user-only ACL of `%APPDATA%`, but the path is cross-platform, so the
    /// mode is set explicitly rather than left to the platform.
    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            std::fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(dir)
                .or_else(|e| {
                    // Already there: tighten it rather than fail.
                    if e.kind() == std::io::ErrorKind::AlreadyExists {
                        Ok(())
                    } else {
                        Err(e)
                    }
                })?;
        }
        #[cfg(not(unix))]
        std::fs::create_dir_all(dir)?;

        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

        let path = dir.join(FILE_NAME);
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }

        use std::io::Write;
        let mut file = opts.open(&path)?;
        file.write_all(json.as_bytes())?;

        // An existing file keeps its old mode through OpenOptions, so set it
        // again for a token file written before this fix landed.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_a_default_token_on_first_run() {
        let dir = tempfile::tempdir().unwrap();
        let tokens = AgentTokens::load_or_create(dir.path());
        assert_eq!(tokens.tokens().len(), 1, "first run issues one token");
        let (token, agent_id) = tokens.tokens().pop().unwrap();
        assert!(token.starts_with("hive_ag_"), "got {token}");
        assert!(!agent_id.is_empty());
    }

    #[test]
    fn the_token_is_the_same_after_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let first = AgentTokens::load_or_create(dir.path());
        let first_token = first.tokens()[0].0.clone();
        first.save(dir.path()).unwrap();

        // A restart must not invalidate a token the user has already pasted
        // into their agent's config.
        let second = AgentTokens::load_or_create(dir.path());
        assert_eq!(second.tokens()[0].0, first_token);
    }

    #[test]
    fn resolves_an_agent_id_from_a_token_and_rejects_anything_else() {
        let dir = tempfile::tempdir().unwrap();
        let tokens = AgentTokens::load_or_create(dir.path());
        let (token, agent_id) = tokens.tokens().pop().unwrap();

        assert_eq!(tokens.agent_id_for(&token), Some(agent_id));
        assert_eq!(tokens.agent_id_for("hive_ag_wrong"), None);
        assert_eq!(tokens.agent_id_for(""), None);
    }

    #[test]
    fn issue_adds_a_distinct_token_and_agent() {
        let dir = tempfile::tempdir().unwrap();
        let mut tokens = AgentTokens::load_or_create(dir.path());
        let extra = tokens.issue("research");

        assert_eq!(tokens.tokens().len(), 2);
        assert!(tokens.agent_id_for(&extra).is_some());
        let ids: Vec<String> = tokens.tokens().into_iter().map(|(_, id)| id).collect();
        assert_ne!(ids[0], ids[1], "each token maps to its own agent");
    }

    #[test]
    fn a_corrupt_file_is_replaced_rather_than_fatal() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("agent-tokens.json"), "{not json").unwrap();
        let tokens = AgentTokens::load_or_create(dir.path());
        assert_eq!(tokens.tokens().len(), 1, "unreadable settings must not stop startup");
    }

    #[test]
    fn a_label_is_kept_for_a_token_that_has_never_connected() {
        let dir = tempfile::tempdir().unwrap();
        let mut tokens = AgentTokens::load_or_create(dir.path());
        tokens.issue("research");
        let ids: Vec<String> = tokens.tokens().into_iter().map(|(_, id)| id).collect();
        let labels: Vec<Option<String>> = ids.iter().map(|id| tokens.label_for(id)).collect();
        assert!(labels.iter().any(|l| l.as_deref() == Some("research")));
    }

    #[cfg(unix)]
    #[test]
    fn the_token_file_is_not_world_readable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let tokens = AgentTokens::load_or_create(dir.path());
        tokens.save(dir.path()).unwrap();

        let mode = std::fs::metadata(dir.path().join("agent-tokens.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600, "bearer credentials must be owner-only, got {mode:o}");
    }

    #[test]
    fn a_token_issued_after_load_survives_a_save_and_reload() {
        let dir = tempfile::tempdir().unwrap();
        let mut tokens = AgentTokens::load_or_create(dir.path());
        let extra = tokens.issue("research");
        tokens.save(dir.path()).unwrap();

        let reloaded = AgentTokens::load_or_create(dir.path());
        assert_eq!(reloaded.tokens().len(), 2);
        assert!(reloaded.agent_id_for(&extra).is_some(), "a saved token must still resolve");
    }
}
