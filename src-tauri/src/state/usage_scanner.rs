use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Local, NaiveDate, Utc};
use serde_json::Value;
use tokio::sync::RwLock;

use crate::models::{DailyUsage, SessionUsage, TokenUsage, UsageSnapshot};

/// How many days of history the dashboard shows.
const HISTORY_DAYS: i64 = 7;

/// Only transcripts touched inside this window are parsed. Claude Code keeps
/// every transcript it has ever written — on a working machine that is
/// gigabytes across thousands of files — so a first run that read all of them
/// would stall startup for no benefit. Older files are recorded at their
/// current length and never read.
const RECENT_WINDOW: Duration = Duration::from_secs(36 * 60 * 60);

/// What we remember about one transcript between scans.
#[derive(Debug, Default)]
struct FileState {
    /// Byte offset of the first line we have *not* consumed. Transcripts are
    /// append-only JSONL, so the next scan resumes here and parses only what
    /// was added — a few KB per turn instead of the whole megabyte file.
    offset: u64,
    /// Usage bucketed by local calendar day, so "today" stays correct across
    /// midnight without re-reading anything.
    by_day: HashMap<NaiveDate, TokenUsage>,
    total: TokenUsage,
    model: Option<String>,
    /// Prompt size of the most recent assistant turn — the live context size.
    context_tokens: u64,
    last_activity: Option<DateTime<Utc>>,
}

/// Reads token usage out of Claude Code's own transcripts.
///
/// Claude Code records a `usage` object on every assistant turn, and names each
/// transcript after its session id. That gives exact per-session numbers with
/// no cooperation needed from the model — nothing depends on Claude remembering
/// to report anything.
///
/// The format is internal to Claude Code and can change between versions, so
/// every read is best-effort: an entry that doesn't parse is skipped rather
/// than failing the scan. Showing nothing beats showing something wrong.
#[derive(Debug, Clone)]
pub struct UsageScanner {
    root: PathBuf,
    files: Arc<RwLock<HashMap<PathBuf, FileState>>>,
    scanned_at: Arc<RwLock<Option<DateTime<Utc>>>>,
}

impl UsageScanner {
    /// Scanner over Claude Code's default transcript directory.
    pub fn new() -> Self {
        let root = dirs::home_dir()
            .map(|h| h.join(".claude").join("projects"))
            .unwrap_or_default();
        Self::with_root(root)
    }

    pub fn with_root(root: PathBuf) -> Self {
        Self {
            root,
            files: Arc::new(RwLock::new(HashMap::new())),
            scanned_at: Arc::new(RwLock::new(None)),
        }
    }

    /// Walk the transcript tree and fold in everything appended since the last
    /// scan. Safe to call on a timer; unchanged files cost one `stat` each.
    pub async fn scan(&self) {
        let Ok(projects) = std::fs::read_dir(&self.root) else {
            return;
        };
        let now = SystemTime::now();
        let mut files = self.files.write().await;

        for project in projects.flatten() {
            let Ok(entries) = std::fs::read_dir(project.path()) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                    continue;
                }
                let Ok(meta) = entry.metadata() else { continue };
                let len = meta.len();

                let known = files.contains_key(&path);
                let recent = meta
                    .modified()
                    .ok()
                    .and_then(|m| now.duration_since(m).ok())
                    .is_some_and(|age| age < RECENT_WINDOW);

                if !known && !recent {
                    // Seen for the first time but already stale — record where
                    // it ends so we never parse its history, only future
                    // appends (of which there will likely be none).
                    files.insert(path, FileState { offset: len, ..Default::default() });
                    continue;
                }

                let state = files.entry(path.clone()).or_default();
                if len == state.offset {
                    continue; // nothing appended
                }
                if len < state.offset {
                    // Truncated or replaced — start over rather than reading
                    // from a byte offset that no longer means anything.
                    *state = FileState::default();
                }
                read_appended(&path, state);
            }
        }

        drop(files);
        *self.scanned_at.write().await = Some(Utc::now());
    }

    /// Current usage, with today's totals split into "everything on this
    /// machine" and "just the sessions the hive knows about".
    pub async fn snapshot(&self, connected_ids: &[String]) -> UsageSnapshot {
        let files = self.files.read().await;
        let today = Local::now().date_naive();

        let mut sessions: Vec<SessionUsage> = Vec::new();
        let mut today_total = TokenUsage::default();
        let mut today_connected = TokenUsage::default();
        let mut today_cost: Option<f64> = None;

        for (path, state) in files.iter() {
            let Some(id) = session_id_of(path) else { continue };
            let today_usage = state.by_day.get(&today).copied().unwrap_or_default();
            today_total.add(&today_usage);
            if connected_ids.iter().any(|c| c == &id) {
                today_connected.add(&today_usage);
            }

            // A file we deliberately skipped has no data worth reporting.
            if state.total.total() == 0 {
                continue;
            }

            let mut usage = SessionUsage {
                claude_session_id: id,
                model: None,
                context_tokens: state.context_tokens,
                context_limit: None,
                total: state.total,
                today: today_usage,
                estimated_cost_usd: None,
                last_activity: state.last_activity,
            };
            usage.set_model(state.model.clone());
            // Today's cost is priced separately from the lifetime total.
            if let Some(model) = usage.model.as_deref() {
                if let Some(cost) = today_usage.estimated_cost_usd(model) {
                    today_cost = Some(today_cost.unwrap_or(0.0) + cost);
                }
            }
            sessions.push(usage);
        }

        sessions.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));

        UsageSnapshot {
            sessions,
            today: today_total,
            today_connected,
            days: recent_days(today, today_total.total()),
            today_cost_usd: today_cost,
            scanned_at: *self.scanned_at.read().await,
        }
    }
}

/// The last `HISTORY_DAYS` days, oldest first.
///
/// Today comes from the live scan. Earlier days come from Claude Code's
/// `stats-cache.json`, because the scanner only opens transcripts touched in
/// the last 36 hours and so cannot see further back. That cache is recomputed
/// daily and lags — which is exactly why today is taken from the live scan
/// instead, and why each day says which source it came from.
fn recent_days(today: NaiveDate, today_tokens: u64) -> Vec<DailyUsage> {
    let history = read_stats_cache_history().unwrap_or_default();
    (0..HISTORY_DAYS)
        .rev()
        .filter_map(|back| today.checked_sub_signed(chrono::Duration::days(back)))
        .map(|date| {
            let key = date.format("%Y-%m-%d").to_string();
            if date == today {
                DailyUsage { date: key, tokens: today_tokens, live: true }
            } else {
                let tokens = history.get(&key).copied().unwrap_or(0);
                DailyUsage { date: key, tokens, live: false }
            }
        })
        .collect()
}

/// Daily token totals from `~/.claude/stats-cache.json`, summed across models.
///
/// Best-effort like everything else here: a missing or reshaped cache yields no
/// history rather than an error, and today's live number stands on its own.
fn read_stats_cache_history() -> Option<HashMap<String, u64>> {
    let path = dirs::home_dir()?.join(".claude").join("stats-cache.json");
    let raw = std::fs::read_to_string(path).ok()?;
    let parsed: Value = serde_json::from_str(&raw).ok()?;

    let mut days = HashMap::new();
    for entry in parsed.get("dailyModelTokens")?.as_array()? {
        let Some(date) = entry.get("date").and_then(|d| d.as_str()) else { continue };
        let total: u64 = entry
            .get("tokensByModel")
            .and_then(|m| m.as_object())
            .map(|m| m.values().filter_map(|v| v.as_u64()).sum())
            .unwrap_or(0);
        days.insert(date.to_string(), total);
    }
    Some(days)
}

/// The transcript filename is the Claude Code session id.
fn session_id_of(path: &Path) -> Option<String> {
    path.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string())
}

/// Parse whole lines appended since `state.offset`, advancing the offset only
/// past lines that were complete. A turn still being written leaves a partial
/// trailing line, which we leave for the next scan.
fn read_appended(path: &Path, state: &mut FileState) {
    let Ok(file) = File::open(path) else { return };
    let mut reader = BufReader::new(file);
    if reader.seek(SeekFrom::Start(state.offset)).is_err() {
        return;
    }

    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(bytes) => {
                if !line.ends_with('\n') {
                    break; // incomplete final line — wait for the rest
                }
                state.offset += bytes as u64;
                apply_entry(&line, state);
            }
            Err(_) => break,
        }
    }
}

/// Fold one transcript line into the running totals. Anything unrecognised is
/// skipped silently — the format is not ours to depend on.
fn apply_entry(line: &str, state: &mut FileState) {
    let Ok(entry) = serde_json::from_str::<Value>(line) else { return };
    let Some(usage) = entry.get("message").and_then(|m| m.get("usage")) else { return };

    let read = |key: &str| usage.get(key).and_then(|v| v.as_u64()).unwrap_or(0);
    let turn = TokenUsage {
        input: read("input_tokens"),
        output: read("output_tokens"),
        cache_read: read("cache_read_input_tokens"),
        cache_creation: read("cache_creation_input_tokens"),
    };
    if turn.total() == 0 {
        return;
    }

    state.total.add(&turn);
    // The newest turn's prompt size is the live context size; earlier turns are
    // history, so this overwrites rather than accumulating.
    state.context_tokens = turn.context_size();

    if let Some(model) = entry.get("message").and_then(|m| m.get("model")).and_then(|m| m.as_str()) {
        state.model = Some(model.to_string());
    }

    let timestamp = entry
        .get("timestamp")
        .and_then(|t| t.as_str())
        .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
        .map(|t| t.with_timezone(&Utc));

    if let Some(ts) = timestamp {
        state.last_activity = Some(ts);
        let day = ts.with_timezone(&Local).date_naive();
        state.by_day.entry(day).or_default().add(&turn);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn transcript(dir: &Path, session_id: &str, lines: &[&str]) -> PathBuf {
        let project = dir.join("some-project");
        std::fs::create_dir_all(&project).unwrap();
        let path = project.join(format!("{}.jsonl", session_id));
        let mut file = File::create(&path).unwrap();
        for line in lines {
            writeln!(file, "{}", line).unwrap();
        }
        path
    }

    fn turn(input: u64, output: u64, cache_read: u64, model: &str, timestamp: &str) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{}","message":{{"model":"{}","usage":{{"input_tokens":{},"output_tokens":{},"cache_read_input_tokens":{},"cache_creation_input_tokens":0}}}}}}"#,
            timestamp, model, input, output, cache_read
        )
    }

    fn today_at(time: &str) -> String {
        format!("{}T{}", Local::now().date_naive(), time)
    }

    #[tokio::test]
    async fn sums_usage_across_a_transcript() {
        let dir = tempfile::tempdir().unwrap();
        transcript(
            dir.path(),
            "sess-1",
            &[
                &turn(10, 20, 100, "claude-opus-5", &today_at("01:00:00+00:00")),
                &turn(5, 7, 200, "claude-opus-5", &today_at("02:00:00+00:00")),
            ],
        );

        let scanner = UsageScanner::with_root(dir.path().to_path_buf());
        scanner.scan().await;
        let snap = scanner.snapshot(&[]).await;

        assert_eq!(snap.sessions.len(), 1);
        let session = &snap.sessions[0];
        assert_eq!(session.claude_session_id, "sess-1");
        assert_eq!(session.total.input, 15);
        assert_eq!(session.total.output, 27);
        assert_eq!(session.total.cache_read, 300);
    }

    #[tokio::test]
    async fn context_size_tracks_the_latest_turn_not_the_sum() {
        let dir = tempfile::tempdir().unwrap();
        transcript(
            dir.path(),
            "sess-1",
            &[
                &turn(10, 20, 100, "claude-opus-5", &today_at("01:00:00+00:00")),
                &turn(5, 7, 200, "claude-opus-5", &today_at("02:00:00+00:00")),
            ],
        );

        let scanner = UsageScanner::with_root(dir.path().to_path_buf());
        scanner.scan().await;
        let snap = scanner.snapshot(&[]).await;

        // Latest turn only: 5 input + 200 cache read.
        assert_eq!(snap.sessions[0].context_tokens, 205);
    }

    #[tokio::test]
    async fn reports_the_context_limit_for_a_known_model() {
        let dir = tempfile::tempdir().unwrap();
        transcript(
            dir.path(),
            "sess-1",
            &[&turn(1, 1, 1, "claude-opus-5", &today_at("01:00:00+00:00"))],
        );

        let scanner = UsageScanner::with_root(dir.path().to_path_buf());
        scanner.scan().await;
        let snap = scanner.snapshot(&[]).await;

        assert_eq!(snap.sessions[0].context_limit, Some(1_000_000));
    }

    #[tokio::test]
    async fn a_second_scan_only_reads_what_was_appended() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(
            dir.path(),
            "sess-1",
            &[&turn(10, 20, 0, "claude-opus-5", &today_at("01:00:00+00:00"))],
        );

        let scanner = UsageScanner::with_root(dir.path().to_path_buf());
        scanner.scan().await;

        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(file, "{}", turn(5, 5, 0, "claude-opus-5", &today_at("02:00:00+00:00"))).unwrap();
        drop(file);

        scanner.scan().await;
        let snap = scanner.snapshot(&[]).await;

        // 15, not 25 — the first turn was counted once, not re-read.
        assert_eq!(snap.sessions[0].total.input, 15);
    }

    #[tokio::test]
    async fn a_partial_trailing_line_is_left_for_the_next_scan() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(
            dir.path(),
            "sess-1",
            &[&turn(10, 20, 0, "claude-opus-5", &today_at("01:00:00+00:00"))],
        );

        // A turn caught mid-write: no trailing newline.
        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        write!(file, "{}", &turn(5, 5, 0, "claude-opus-5", &today_at("02:00:00+00:00"))[..40]).unwrap();
        drop(file);

        let scanner = UsageScanner::with_root(dir.path().to_path_buf());
        scanner.scan().await;
        let snap = scanner.snapshot(&[]).await;

        assert_eq!(snap.sessions[0].total.input, 10);

        // Finish the line; the next scan picks it up whole.
        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(file, "{}", &turn(5, 5, 0, "claude-opus-5", &today_at("02:00:00+00:00"))[40..]).unwrap();
        drop(file);

        scanner.scan().await;
        let snap = scanner.snapshot(&[]).await;
        assert_eq!(snap.sessions[0].total.input, 15);
    }

    #[tokio::test]
    async fn malformed_and_usageless_lines_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        transcript(
            dir.path(),
            "sess-1",
            &[
                "not json at all",
                r#"{"type":"user","message":{"content":"hi"}}"#,
                r#"{"type":"assistant","message":{"model":"claude-opus-5"}}"#,
                &turn(10, 20, 0, "claude-opus-5", &today_at("01:00:00+00:00")),
            ],
        );

        let scanner = UsageScanner::with_root(dir.path().to_path_buf());
        scanner.scan().await;
        let snap = scanner.snapshot(&[]).await;

        assert_eq!(snap.sessions[0].total.input, 10);
    }

    #[tokio::test]
    async fn today_totals_cover_every_session_on_the_machine() {
        let dir = tempfile::tempdir().unwrap();
        transcript(dir.path(), "sess-1", &[&turn(10, 0, 0, "claude-opus-5", &today_at("01:00:00+00:00"))]);
        transcript(dir.path(), "sess-2", &[&turn(7, 0, 0, "claude-opus-5", &today_at("02:00:00+00:00"))]);

        let scanner = UsageScanner::with_root(dir.path().to_path_buf());
        scanner.scan().await;
        let snap = scanner.snapshot(&["sess-1".to_string()]).await;

        assert_eq!(snap.today.input, 17, "every session counts toward the machine total");
        assert_eq!(snap.today_connected.input, 10, "only connected sessions count here");
    }

    #[tokio::test]
    async fn usage_from_another_day_is_excluded_from_today() {
        let dir = tempfile::tempdir().unwrap();
        transcript(
            dir.path(),
            "sess-1",
            &[
                &turn(100, 0, 0, "claude-opus-5", "2020-01-01T01:00:00+00:00"),
                &turn(10, 0, 0, "claude-opus-5", &today_at("01:00:00+00:00")),
            ],
        );

        let scanner = UsageScanner::with_root(dir.path().to_path_buf());
        scanner.scan().await;
        let snap = scanner.snapshot(&[]).await;

        assert_eq!(snap.today.input, 10);
        assert_eq!(snap.sessions[0].total.input, 110, "the lifetime total still includes it");
    }

    #[tokio::test]
    async fn a_truncated_transcript_is_re_read_from_the_start() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(
            dir.path(),
            "sess-1",
            &[
                &turn(10, 0, 0, "claude-opus-5", &today_at("01:00:00+00:00")),
                &turn(10, 0, 0, "claude-opus-5", &today_at("02:00:00+00:00")),
            ],
        );

        let scanner = UsageScanner::with_root(dir.path().to_path_buf());
        scanner.scan().await;
        assert_eq!(scanner.snapshot(&[]).await.sessions[0].total.input, 20);

        // Rewritten shorter — the stored offset now points past the end.
        let mut file = File::create(&path).unwrap();
        writeln!(file, "{}", turn(3, 0, 0, "claude-opus-5", &today_at("03:00:00+00:00"))).unwrap();
        drop(file);

        scanner.scan().await;
        assert_eq!(scanner.snapshot(&[]).await.sessions[0].total.input, 3);
    }

    #[tokio::test]
    async fn a_missing_transcript_directory_is_not_an_error() {
        let scanner = UsageScanner::with_root(PathBuf::from("/definitely/not/here"));
        scanner.scan().await;
        let snap = scanner.snapshot(&[]).await;
        assert!(snap.sessions.is_empty());
        assert_eq!(snap.today.total(), 0);
    }
}
