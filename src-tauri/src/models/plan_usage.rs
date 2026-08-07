use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// One rate-limit window from Claude Code's plan usage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    /// How much of the window is spent, 0-100.
    #[serde(alias = "utilization")]
    pub utilization: Option<f64>,
    /// When the window rolls over.
    #[serde(alias = "resets_at")]
    pub resets_at: Option<DateTime<Utc>>,
}

/// Pay-as-you-go credits beyond the plan, when the account has them enabled.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExtraUsage {
    #[serde(alias = "is_enabled", default)]
    pub is_enabled: bool,
    #[serde(alias = "monthly_limit")]
    pub monthly_limit: Option<f64>,
    #[serde(alias = "used_credits")]
    pub used_credits: Option<f64>,
    pub utilization: Option<f64>,
    pub currency: Option<String>,
}

/// The plan limits behind `/status` → Usage: how much of each rate-limit
/// window is spent and when it resets.
///
/// Unlike everything else in this module, this can't be read off disk — it
/// comes from `GET https://api.anthropic.com/api/oauth/usage`, authenticated
/// with the OAuth token Claude Code already stores. The endpoint is
/// undocumented, so every field is optional and a shape change degrades to
/// showing nothing rather than showing something wrong.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanUsage {
    #[serde(alias = "five_hour")]
    pub five_hour: Option<UsageWindow>,
    #[serde(alias = "seven_day")]
    pub seven_day: Option<UsageWindow>,
    #[serde(alias = "seven_day_opus")]
    pub seven_day_opus: Option<UsageWindow>,
    #[serde(alias = "seven_day_sonnet")]
    pub seven_day_sonnet: Option<UsageWindow>,
    #[serde(alias = "extra_usage")]
    pub extra_usage: Option<ExtraUsage>,
}

impl PlanUsage {
    /// True when the payload carried no window at all — a successful request
    /// whose shape we no longer recognise. Treated as "nothing to show".
    pub fn is_empty(&self) -> bool {
        self.five_hour.is_none()
            && self.seven_day.is_none()
            && self.seven_day_opus.is_none()
            && self.seven_day_sonnet.is_none()
    }
}

/// Why plan usage isn't on screen, so the dashboard can say something useful
/// instead of just hiding.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanUsageStatus {
    /// Fetched and current.
    Ok,
    /// No credentials file, or no token inside it — not logged in via
    /// Claude Code, or using an API key rather than a subscription.
    NotLoggedIn,
    /// The token was rejected. Claude Code rotates it in the background, so
    /// this usually clears itself on the next poll.
    Expired,
    /// Network, timeout, or a 5xx from the endpoint.
    Unavailable,
    /// Nothing has been fetched yet this run.
    Pending,
}

/// What the dashboard receives.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanUsageSnapshot {
    pub status: PlanUsageStatus,
    pub usage: Option<PlanUsage>,
    pub fetched_at: Option<DateTime<Utc>>,
}

impl Default for PlanUsageSnapshot {
    fn default() -> Self {
        Self { status: PlanUsageStatus::Pending, usage: None, fetched_at: None }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact shape the endpoint returns, per agent-dock's model.
    const SAMPLE: &str = r#"{
        "five_hour": { "utilization": 42.5, "resets_at": "2026-08-07T14:20:00Z" },
        "seven_day": { "utilization": 12.0, "resets_at": "2026-08-11T00:00:00Z" },
        "seven_day_opus": { "utilization": 30.0, "resets_at": "2026-08-11T00:00:00Z" },
        "seven_day_sonnet": null,
        "extra_usage": {
            "is_enabled": true, "monthly_limit": 50.0,
            "used_credits": 12.5, "utilization": 25.0, "currency": "USD"
        }
    }"#;

    #[test]
    fn parses_the_documented_shape() {
        let usage: PlanUsage = serde_json::from_str(SAMPLE).unwrap();

        let five = usage.five_hour.unwrap();
        assert_eq!(five.utilization, Some(42.5));
        assert_eq!(five.resets_at.unwrap().to_rfc3339(), "2026-08-07T14:20:00+00:00");
        assert_eq!(usage.seven_day.unwrap().utilization, Some(12.0));
        assert!(usage.seven_day_sonnet.is_none());

        let extra = usage.extra_usage.unwrap();
        assert!(extra.is_enabled);
        assert_eq!(extra.used_credits, Some(12.5));
        assert_eq!(extra.currency.as_deref(), Some("USD"));
    }

    #[test]
    fn tolerates_a_window_missing_its_fields() {
        // The endpoint is undocumented; absent fields must not fail the parse.
        let usage: PlanUsage = serde_json::from_str(r#"{"five_hour":{}}"#).unwrap();
        let five = usage.five_hour.unwrap();
        assert_eq!(five.utilization, None);
        assert_eq!(five.resets_at, None);
    }

    #[test]
    fn tolerates_unknown_and_absent_fields() {
        let usage: PlanUsage =
            serde_json::from_str(r#"{"something_new": 1, "five_hour": {"utilization": 5}}"#)
                .unwrap();
        assert_eq!(usage.five_hour.unwrap().utilization, Some(5.0));
        assert!(usage.seven_day.is_none());
    }

    #[test]
    fn an_unrecognised_payload_reports_itself_empty() {
        let usage: PlanUsage = serde_json::from_str(r#"{"totally": "different"}"#).unwrap();
        assert!(usage.is_empty(), "nothing to show beats showing something wrong");
    }

    #[test]
    fn a_payload_with_any_window_is_not_empty() {
        let usage: PlanUsage = serde_json::from_str(r#"{"seven_day":{"utilization":1}}"#).unwrap();
        assert!(!usage.is_empty());
    }
}
