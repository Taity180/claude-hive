use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use serde_json::Value;
use tokio::sync::RwLock;

use crate::models::{PlanUsage, PlanUsageSnapshot, PlanUsageStatus};

/// Claude Code's own plan-usage endpoint — the data behind `/status` → Usage.
const USAGE_ENDPOINT: &str = "https://api.anthropic.com/api/oauth/usage";
/// Required for the OAuth (subscription) auth surface, as opposed to API keys.
const OAUTH_BETA: &str = "oauth-2025-04-20";
const TIMEOUT: Duration = Duration::from_secs(15);

/// Fetches how much of the plan's rate-limit windows are spent.
///
/// This is the one thing in the hive that can't be read off disk: rate-limit
/// windows are a subscription concept and live only behind Anthropic's API.
/// Authentication reuses the OAuth token Claude Code already stores at
/// `~/.claude/.credentials.json` — no API key, and nothing new to configure.
///
/// The token is re-read on **every** poll rather than cached. Claude Code
/// rotates it in the background, and a user who logs into a different account
/// gets different numbers within one poll instead of stale ones from the
/// previous login.
///
/// The endpoint is undocumented. Every failure resolves to a status the
/// dashboard can explain and then show nothing, never a stale or guessed
/// percentage.
#[derive(Debug, Clone)]
pub struct PlanUsageClient {
    credentials_path: PathBuf,
    snapshot: Arc<RwLock<PlanUsageSnapshot>>,
    client: reqwest::Client,
}

impl PlanUsageClient {
    pub fn new() -> Self {
        let credentials_path = dirs::home_dir()
            .map(|h| h.join(".claude").join(".credentials.json"))
            .unwrap_or_default();
        Self::with_credentials_path(credentials_path)
    }

    pub fn with_credentials_path(credentials_path: PathBuf) -> Self {
        Self {
            credentials_path,
            snapshot: Arc::new(RwLock::new(PlanUsageSnapshot::default())),
            client: reqwest::Client::builder()
                .timeout(TIMEOUT)
                .build()
                .unwrap_or_default(),
        }
    }

    pub async fn snapshot(&self) -> PlanUsageSnapshot {
        self.snapshot.read().await.clone()
    }

    /// Read the current token and refresh the cached snapshot.
    pub async fn refresh(&self) {
        let next = self.fetch().await;
        *self.snapshot.write().await = next;
    }

    async fn fetch(&self) -> PlanUsageSnapshot {
        let Some(token) = read_access_token(&self.credentials_path) else {
            return PlanUsageSnapshot {
                status: PlanUsageStatus::NotLoggedIn,
                usage: None,
                fetched_at: Some(Utc::now()),
            };
        };

        let response = self
            .client
            .get(USAGE_ENDPOINT)
            .bearer_auth(token)
            .header("anthropic-beta", OAUTH_BETA)
            .send()
            .await;

        let response = match response {
            Ok(r) => r,
            // DNS, offline, timeout — keep quiet and retry next tick.
            Err(_) => return self.degraded(PlanUsageStatus::Unavailable).await,
        };

        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            // Claude Code rotates the token in the background, so this usually
            // clears itself on the next poll.
            return self.degraded(PlanUsageStatus::Expired).await;
        }
        if !response.status().is_success() {
            return self.degraded(PlanUsageStatus::Unavailable).await;
        }

        match response.json::<PlanUsage>().await {
            Ok(usage) if !usage.is_empty() => PlanUsageSnapshot {
                status: PlanUsageStatus::Ok,
                usage: Some(usage),
                fetched_at: Some(Utc::now()),
            },
            // Parsed but carried no window, or didn't parse at all: the shape
            // changed under us. Show nothing rather than something wrong.
            _ => self.degraded(PlanUsageStatus::Unavailable).await,
        }
    }

    /// Record a failure without discarding the last good numbers — a blip
    /// shouldn't blank a reading that was correct 60 seconds ago. The status
    /// travels with it so the dashboard can mark it stale.
    async fn degraded(&self, status: PlanUsageStatus) -> PlanUsageSnapshot {
        let previous = self.snapshot.read().await.clone();
        PlanUsageSnapshot { status, usage: previous.usage, fetched_at: previous.fetched_at }
    }
}

/// Pull `claudeAiOauth.accessToken` out of Claude Code's credentials file.
///
/// Returns `None` for a missing, unreadable, or unrecognised file — which also
/// covers users authenticating with an API key, who have no plan windows to
/// report in the first place.
fn read_access_token(path: &PathBuf) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let parsed: Value = serde_json::from_str(&raw).ok()?;
    let token = parsed.get("claudeAiOauth")?.get("accessToken")?.as_str()?;
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn credentials_file(contents: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".credentials.json");
        let mut file = std::fs::File::create(&path).unwrap();
        write!(file, "{}", contents).unwrap();
        (dir, path)
    }

    #[test]
    fn reads_the_oauth_access_token() {
        let (_dir, path) = credentials_file(r#"{"claudeAiOauth":{"accessToken":"tok-123"}}"#);
        assert_eq!(read_access_token(&path).as_deref(), Some("tok-123"));
    }

    #[test]
    fn a_missing_file_yields_no_token() {
        assert_eq!(read_access_token(&PathBuf::from("/definitely/not/here")), None);
    }

    #[test]
    fn an_api_key_login_yields_no_token() {
        // No claudeAiOauth block at all — nothing to report, not an error.
        let (_dir, path) = credentials_file(r#"{"somethingElse":{"key":"sk-ant-x"}}"#);
        assert_eq!(read_access_token(&path), None);
    }

    #[test]
    fn malformed_json_yields_no_token() {
        let (_dir, path) = credentials_file("not json");
        assert_eq!(read_access_token(&path), None);
    }

    #[test]
    fn an_empty_token_counts_as_absent() {
        let (_dir, path) = credentials_file(r#"{"claudeAiOauth":{"accessToken":""}}"#);
        assert_eq!(read_access_token(&path), None);
    }

    #[tokio::test]
    async fn reports_not_logged_in_without_credentials() {
        let client = PlanUsageClient::with_credentials_path(PathBuf::from("/nope"));
        client.refresh().await;

        let snap = client.snapshot().await;
        assert_eq!(snap.status, PlanUsageStatus::NotLoggedIn);
        assert!(snap.usage.is_none());
    }

    #[tokio::test]
    async fn starts_pending_before_the_first_fetch() {
        let client = PlanUsageClient::with_credentials_path(PathBuf::from("/nope"));
        let snap = client.snapshot().await;
        assert_eq!(snap.status, PlanUsageStatus::Pending);
    }

    #[tokio::test]
    async fn a_failure_keeps_the_last_good_numbers_but_marks_them() {
        let client = PlanUsageClient::with_credentials_path(PathBuf::from("/nope"));
        *client.snapshot.write().await = PlanUsageSnapshot {
            status: PlanUsageStatus::Ok,
            usage: Some(PlanUsage {
                five_hour: Some(crate::models::UsageWindow {
                    utilization: Some(42.0),
                    resets_at: None,
                }),
                ..Default::default()
            }),
            fetched_at: Some(Utc::now()),
        };

        let degraded = client.degraded(PlanUsageStatus::Unavailable).await;

        assert_eq!(degraded.status, PlanUsageStatus::Unavailable);
        assert_eq!(
            degraded.usage.unwrap().five_hour.unwrap().utilization,
            Some(42.0),
            "a blip shouldn't blank a reading that was right a minute ago"
        );
    }
}
