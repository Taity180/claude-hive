use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Tokens consumed, split the way the API reports them.
///
/// Cache reads and cache writes are tracked separately from fresh input
/// because they are priced differently — lumping them together would make a
/// heavily-cached session look far more expensive than it is.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
}

impl TokenUsage {
    pub fn total(&self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_creation
    }

    pub fn add(&mut self, other: &TokenUsage) {
        self.input += other.input;
        self.output += other.output;
        self.cache_read += other.cache_read;
        self.cache_creation += other.cache_creation;
    }

    /// What the model was sent to produce one response: fresh input plus
    /// everything served from or written to cache. This is the working context
    /// size, which is the number worth watching — not the cumulative total.
    pub fn context_size(&self) -> u64 {
        self.input + self.cache_read + self.cache_creation
    }

    /// Rough dollar cost of these tokens at published API rates.
    ///
    /// An **estimate**, not a bill. On a subscription plan nothing is charged
    /// per token at all, and even on API billing this can't see discounts,
    /// promotional rates, or the exact cache TTL that was used. Returns `None`
    /// for a model with no known rates rather than pricing it at zero.
    pub fn estimated_cost_usd(&self, model: &str) -> Option<f64> {
        let rates = model_rates(model)?;
        const MTOK: f64 = 1_000_000.0;
        Some(
            self.input as f64 / MTOK * rates.input
                + self.output as f64 / MTOK * rates.output
                // Cache reads bill at ~0.1x input; 5-minute cache writes at 1.25x.
                + self.cache_read as f64 / MTOK * rates.input * 0.1
                + self.cache_creation as f64 / MTOK * rates.input * 1.25,
        )
    }
}

/// Per-million-token rates.
struct ModelRates {
    input: f64,
    output: f64,
}

/// Published API rates per million tokens.
///
/// Hardcoded for the same reason context windows are: no credentials, no
/// pricing endpoint. Introductory and promotional rates are deliberately
/// ignored — they expire, and an estimate that silently drifts is worse than
/// one that is consistently a little high.
fn model_rates(model: &str) -> Option<ModelRates> {
    match normalize_model(model).as_str() {
        "claude-fable-5" | "claude-mythos-5" => Some(ModelRates { input: 10.0, output: 50.0 }),
        "claude-opus-5" | "claude-opus-4-8" | "claude-opus-4-7" | "claude-opus-4-6"
        | "claude-opus-4-5" => Some(ModelRates { input: 5.0, output: 25.0 }),
        "claude-sonnet-5" | "claude-sonnet-4-6" | "claude-sonnet-4-5" | "claude-sonnet-4-0" => {
            Some(ModelRates { input: 3.0, output: 15.0 })
        }
        "claude-haiku-4-5" => Some(ModelRates { input: 1.0, output: 5.0 }),
        _ => None,
    }
}

/// Context windows by model, so "142k used" can become "14% of the window".
///
/// Hardcoded because the hive holds no Anthropic credentials and cannot query
/// the Models API for `max_input_tokens`. A model missing from this table
/// reports its token count with **no percentage** rather than a guessed one —
/// a wrong denominator is worse than none.
fn context_limit(model: &str) -> Option<u64> {
    match normalize_model(model) {
        m if matches!(
            m.as_str(),
            "claude-fable-5" | "claude-mythos-5" | "claude-opus-5" | "claude-opus-4-8"
                | "claude-opus-4-7" | "claude-opus-4-6" | "claude-sonnet-5" | "claude-sonnet-4-6"
        ) =>
        {
            Some(1_000_000)
        }
        m if matches!(
            m.as_str(),
            "claude-haiku-4-5" | "claude-opus-4-5" | "claude-opus-4-1" | "claude-opus-4-0"
                | "claude-sonnet-4-5" | "claude-sonnet-4-0"
        ) =>
        {
            Some(200_000)
        }
        // Every Claude 3.x model shipped with a 200K window. They're retired,
        // but old transcripts still name them.
        m if m.starts_with("claude-3-") || m == "claude-2.1" || m == "claude-2.0" => Some(200_000),
        _ => None,
    }
}

/// Reduce a transcript's model string to the plain alias the table is keyed on.
///
/// Transcripts carry whatever Claude Code was running: a bare alias
/// (`claude-opus-4-7`), a variant suffix (`claude-opus-5[1m]`), or a dated
/// snapshot id (`claude-sonnet-4-5-20250929`). All three name the same window.
fn normalize_model(model: &str) -> String {
    let base = model.split('[').next().unwrap_or(model).trim();
    // Strip a trailing -YYYYMMDD snapshot date, but leave versions like
    // "claude-opus-4-7" alone — those segments are far too short to be a date.
    match base.rsplit_once('-') {
        Some((head, tail)) if tail.len() == 8 && tail.chars().all(|c| c.is_ascii_digit()) => {
            head.to_string()
        }
        _ => base.to_string(),
    }
}

/// One Claude Code session's token usage, keyed by the session id that names
/// its transcript file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsage {
    pub claude_session_id: String,
    pub model: Option<String>,
    /// Size of the prompt sent for the most recent response — how full the
    /// context window currently is.
    pub context_tokens: u64,
    /// The model's context window, when it's a model we know the size of.
    pub context_limit: Option<u64>,
    /// Everything this session has consumed, cumulatively.
    pub total: TokenUsage,
    /// This session's share of today, so the dashboard can rank who spent what.
    pub today: TokenUsage,
    /// Estimated dollar cost of `total` at published rates, when the model has
    /// known rates. Never a bill — see `TokenUsage::estimated_cost_usd`.
    pub estimated_cost_usd: Option<f64>,
    pub last_activity: Option<DateTime<Utc>>,
}

impl SessionUsage {
    /// Set the model and derive everything that depends on it.
    pub fn set_model(&mut self, model: Option<String>) {
        self.context_limit = model.as_deref().and_then(context_limit);
        self.estimated_cost_usd = model
            .as_deref()
            .and_then(|m| self.total.estimated_cost_usd(m));
        self.model = model;
    }
}

/// One calendar day's machine-wide token total, counting **input + output
/// only** — no cache reads or writes.
///
/// That basis is forced by the history source. Claude Code's
/// `stats-cache.json` records one number per model per day and it excludes
/// cache traffic; measured against the same day, the cache is ~300x the
/// input+output volume. Plotting today's all-inclusive total next to
/// cache-free history would make today's bar dwarf every other day and mean
/// nothing. The full split for today lives on `UsageSnapshot::today`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    /// Local date, `YYYY-MM-DD`.
    pub date: String,
    pub tokens: u64,
    /// True for the day the live scanner produced, false for days read from
    /// the stats cache — which Claude Code recomputes daily and so lags.
    pub live: bool,
}

/// Everything the scanner knows, as served to the dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    /// Per Claude Code session id. The dashboard joins these to hive sessions
    /// via the `claudeSessionId` a hook reports.
    pub sessions: Vec<SessionUsage>,
    /// Every session's usage today, including sessions that never connected to
    /// the hive — the machine-wide number.
    pub today: TokenUsage,
    /// Today's usage from sessions currently connected to the hive.
    pub today_connected: TokenUsage,
    /// The last 7 days, oldest first, for trend context.
    pub days: Vec<DailyUsage>,
    /// Estimated cost of today's usage, summed over sessions whose model has
    /// known rates. `None` when nothing today could be priced.
    pub today_cost_usd: Option<f64>,
    pub scanned_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetClaudeSessionRequest {
    pub claude_session_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn total_sums_every_bucket() {
        let usage = TokenUsage { input: 1, output: 2, cache_read: 4, cache_creation: 8 };
        assert_eq!(usage.total(), 15);
    }

    #[test]
    fn context_size_excludes_output() {
        let usage = TokenUsage { input: 1, output: 2, cache_read: 4, cache_creation: 8 };
        assert_eq!(usage.context_size(), 13);
    }

    #[test]
    fn add_accumulates_each_bucket() {
        let mut usage = TokenUsage { input: 1, output: 2, cache_read: 3, cache_creation: 4 };
        usage.add(&TokenUsage { input: 10, output: 20, cache_read: 30, cache_creation: 40 });
        assert_eq!(usage, TokenUsage { input: 11, output: 22, cache_read: 33, cache_creation: 44 });
    }

    #[test]
    fn known_models_report_their_window() {
        assert_eq!(context_limit("claude-opus-5"), Some(1_000_000));
        assert_eq!(context_limit("claude-haiku-4-5"), Some(200_000));
    }

    #[test]
    fn variant_suffixes_resolve_to_the_base_model() {
        // Claude Code writes ids like "claude-opus-5[1m]" into transcripts.
        assert_eq!(context_limit("claude-opus-5[1m]"), Some(1_000_000));
    }

    #[test]
    fn cost_prices_each_bucket_at_its_own_rate() {
        // Opus 5: $5/MTok in, $25/MTok out, cache read 0.1x in, cache write 1.25x in.
        let usage = TokenUsage {
            input: 1_000_000,
            output: 1_000_000,
            cache_read: 1_000_000,
            cache_creation: 1_000_000,
        };
        // 5 + 25 + 0.5 + 6.25
        let cost = usage.estimated_cost_usd("claude-opus-5").unwrap();
        assert!((cost - 36.75).abs() < 1e-9, "got {}", cost);
    }

    #[test]
    fn cost_is_none_for_a_model_with_no_known_rates() {
        let usage = TokenUsage { input: 1_000_000, ..Default::default() };
        assert_eq!(usage.estimated_cost_usd("mystery-model"), None);
        // Priced at zero would read as "this was free", which is worse.
        assert_eq!(usage.estimated_cost_usd("claude-3-haiku-20240307"), None);
    }

    #[test]
    fn cost_uses_the_alias_behind_a_dated_or_suffixed_id() {
        let usage = TokenUsage { output: 1_000_000, ..Default::default() };
        assert_eq!(usage.estimated_cost_usd("claude-opus-5[1m]"), Some(25.0));
        assert_eq!(usage.estimated_cost_usd("claude-sonnet-4-5-20250929"), Some(15.0));
    }

    #[test]
    fn set_model_prices_the_lifetime_total() {
        let mut usage = SessionUsage {
            claude_session_id: "s1".to_string(),
            model: None,
            context_tokens: 0,
            context_limit: None,
            total: TokenUsage { output: 1_000_000, ..Default::default() },
            today: TokenUsage::default(),
            estimated_cost_usd: None,
            last_activity: None,
        };

        usage.set_model(Some("claude-opus-5".to_string()));
        assert_eq!(usage.estimated_cost_usd, Some(25.0));

        usage.set_model(Some("mystery".to_string()));
        assert_eq!(usage.estimated_cost_usd, None);
    }

    #[test]
    fn dated_snapshot_ids_resolve_to_their_alias() {
        // Real transcripts carry the full dated id for older models.
        assert_eq!(context_limit("claude-sonnet-4-5-20250929"), Some(200_000));
        assert_eq!(context_limit("claude-opus-4-5-20251101"), Some(200_000));
        assert_eq!(context_limit("claude-haiku-4-5-20251001"), Some(200_000));
    }

    #[test]
    fn retired_claude_3_models_still_resolve() {
        assert_eq!(context_limit("claude-3-5-sonnet-20241022"), Some(200_000));
        assert_eq!(context_limit("claude-3-haiku-20240307"), Some(200_000));
    }

    #[test]
    fn a_version_segment_is_not_mistaken_for_a_date() {
        // "4-7" must survive; only an 8-digit trailing segment is a date.
        assert_eq!(normalize_model("claude-opus-4-7"), "claude-opus-4-7");
        assert_eq!(normalize_model("claude-sonnet-4-5-20250929"), "claude-sonnet-4-5");
    }

    #[test]
    fn unknown_models_report_no_window_rather_than_a_guess() {
        assert_eq!(context_limit("claude-something-7"), None);
        assert_eq!(context_limit(""), None);
    }

    #[test]
    fn set_model_resolves_the_limit_alongside_the_name() {
        let mut usage = SessionUsage {
            claude_session_id: "s1".to_string(),
            model: None,
            context_tokens: 0,
            context_limit: None,
            total: TokenUsage::default(),
            today: TokenUsage::default(),
            estimated_cost_usd: None,
            last_activity: None,
        };

        usage.set_model(Some("claude-opus-4-7".to_string()));
        assert_eq!(usage.context_limit, Some(1_000_000));

        usage.set_model(Some("mystery-model".to_string()));
        assert_eq!(usage.context_limit, None);
    }
}
