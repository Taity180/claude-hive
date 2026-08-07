// Shared helpers for the Claude Hive hooks.
//
// Every hook needs to answer the same question first: "which hive session am
// I?" The hive server hands out its own session ids (the MCP server registers
// and gets a uuid back), while hooks only know Claude Code's session id. The
// two never meet, so hooks used to match on the working directory alone.
//
// That breaks the moment two Claude Code sessions are open in the same repo —
// a very ordinary thing to do. `sessions.find(...)` returns whichever session
// happens to be first, so one session's Stop hook rewrites the other's status,
// and one session's SessionEnd hook deletes the other's pill off the dashboard.
//
// Instead we claim: the first hook of a Claude Code session to see an
// unclaimed hive session in this working directory writes a claim file keyed
// by Claude Code's session id, and every later hook of that session reads the
// claim back. Claims are 1:1, so even if two same-directory sessions end up
// paired the "wrong" way round (they are indistinguishable on the dashboard
// anyway — same project, same branch), no session can ever clobber another.

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";

const CLAIM_SUFFIX = ".session";
const TIMEOUT_MS = 1000;

/**
 * Where claim files live. Read lazily (not captured at import time) so tests
 * can point it somewhere disposable via CLAUDE_HIVE_STATE_DIR.
 */
function claimDir() {
  return process.env.CLAUDE_HIVE_STATE_DIR || join(homedir(), ".claude", "hive-hooks");
}

/** Base URL of the hive HTTP server. */
export function hiveUrl() {
  return `http://localhost:${process.env.CLAUDE_HIVE_PORT || "9400"}`;
}

/** Read and parse the hook event JSON from stdin. Resolves to null on bad input. */
export function readEvent() {
  return new Promise((resolve) => {
    let input = "";
    process.stdin.on("data", (chunk) => (input += chunk));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(input));
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Stable per-Claude-Code-session key used to name claim files, or null when
 * the payload carries no session id.
 *
 * The whole point of a claim is that it's unique to one Claude Code session.
 * Deriving a key from the working directory instead would hand two sessions in
 * the same repo the *same* claim file — exactly the shared state this replaced.
 * So a payload without a session id gets no claim, and its hooks fall back to
 * acting only when a single session unambiguously matches the directory.
 */
export function claimKey(event) {
  const raw = event?.session_id;
  if (!raw) return null;
  return String(raw).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

/** The working directory the hook is running against. */
export function eventCwd(event) {
  return event?.cwd || process.cwd();
}

function normalizeDir(dir) {
  return String(dir || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function claimPathFor(key) {
  return join(claimDir(), `${key}${CLAIM_SUFFIX}`);
}

function sanitize(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

/**
 * Path of this session's "a permission prompt is pending" flag. Unlike a
 * claim, this may fall back to the working directory: the worst a shared flag
 * can do is let one session clear another's, and PostToolUse still has to
 * resolve a session before it acts on it.
 */
export function pendingPath(event) {
  const key = claimKey(event) ?? `cwd-${sanitize(eventCwd(event))}`;
  return join(claimDir(), `${key}.pending`);
}

function readFileOrNull(path) {
  try {
    return readFileSync(path, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function removeFile(path) {
  try {
    unlinkSync(path);
  } catch {}
}

function writeClaim(key, sessionId) {
  try {
    mkdirSync(claimDir(), { recursive: true });
    writeFileSync(claimPathFor(key), sessionId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every claim currently held by *other* Claude Code sessions, as a
 * Map<hiveSessionId, claimKey>. Claims pointing at sessions the hive no longer
 * knows about are deleted on the way through, so a crashed session can't
 * reserve a slot forever.
 */
function otherClaims(exceptKey, liveIds) {
  const held = new Map();
  const dir = claimDir();
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return held;
  }

  for (const entry of entries) {
    if (!entry.endsWith(CLAIM_SUFFIX)) continue;
    const key = entry.slice(0, -CLAIM_SUFFIX.length);
    if (key === exceptKey) continue;

    const path = join(dir, entry);
    const sessionId = readFileOrNull(path);
    if (!sessionId || !liveIds.has(sessionId)) {
      removeFile(path);
      continue;
    }
    held.set(sessionId, key);
  }
  return held;
}

async function fetchSessions(url) {
  try {
    const resp = await fetch(`${url}/api/sessions`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const sessions = await resp.json();
    return Array.isArray(sessions) ? sessions : null;
  } catch {
    return null;
  }
}

/**
 * Work out which hive session this hook belongs to.
 *
 * @param {object} event Hook payload from stdin.
 * @param {object} [options]
 * @param {boolean} [options.claim=true] Claim a session when none is held yet.
 *   Destructive hooks (SessionEnd) pass `requireUnambiguous` as well so they
 *   never delete a sibling session's pill on a guess.
 * @param {boolean} [options.requireUnambiguous=false] Only claim when exactly
 *   one unclaimed session matches this working directory. Forced on when the
 *   payload has no session id and there is therefore nothing to claim with.
 * @returns {Promise<{id: string, session: object, url: string} | null>}
 */
export async function resolveSession(event, options = {}) {
  const { claim = true } = options;
  const url = hiveUrl();

  const sessions = await fetchSessions(url);
  if (!sessions) return null;

  const byId = new Map(sessions.map((s) => [s.id, s]));
  const key = claimKey(event);
  // Without a claim key we can't tell ourselves apart from a sibling session,
  // so only act when exactly one session matches the directory.
  const requireUnambiguous = options.requireUnambiguous || key === null;

  if (key !== null) {
    const path = claimPathFor(key);
    // An existing claim wins as long as the hive still knows that session.
    const claimed = readFileOrNull(path);
    if (claimed) {
      const session = byId.get(claimed);
      if (session) return { id: claimed, session, url };
      // Hive restarted and handed out fresh ids — drop the claim and re-claim.
      removeFile(path);
    }
  }

  if (!claim) return null;

  const dir = normalizeDir(eventCwd(event));
  const candidates = sessions
    .filter((s) => normalizeDir(s.workingDirectory) === dir)
    .sort(
      (a, b) =>
        String(a.connectedAt || "").localeCompare(String(b.connectedAt || "")) ||
        String(a.id).localeCompare(String(b.id)),
    );
  if (candidates.length === 0) return null;

  const held = otherClaims(key, new Set(byId.keys()));
  const free = candidates.filter((s) => !held.has(s.id));
  if (free.length === 0) return null;
  if (requireUnambiguous && free.length > 1) return null;

  let chosen = free[0];
  // No key means no claim to record — the unambiguous check above is the only
  // thing standing between us and a sibling's session, and it passed.
  if (key === null) return { id: chosen.id, session: chosen, url };

  if (!writeClaim(key, chosen.id)) return null;

  // Two sessions starting at the same instant can both pick the same slot.
  // Settle it deterministically: the lexicographically smallest claim key
  // keeps it, the other steps aside to the next free session.
  const rivals = otherClaims(key, new Set(byId.keys()));
  const rivalKey = rivals.get(chosen.id);
  if (rivalKey && rivalKey < key) {
    removeFile(claimPathFor(key));
    const next = free.find((s) => s.id !== chosen.id && !rivals.has(s.id));
    if (!next) return null;
    if (!writeClaim(key, next.id)) return null;
    chosen = next;
  }

  return { id: chosen.id, session: chosen, url };
}

/** Push a status update for a resolved session. Never throws. */
export async function setStatus(url, sessionId, status, detail) {
  try {
    await fetch(`${url}/api/sessions/${sessionId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, detail, silent: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {}
}

/**
 * Tell the hive which Claude Code session a hive session belongs to.
 *
 * Claude Code names each transcript after its session id, and that transcript
 * is where token usage lives — so this pairing is what lets the dashboard
 * attribute usage to the right pill. Only a hook knows both halves.
 * Never throws.
 */
export async function reportClaudeSession(url, sessionId, claudeSessionId) {
  if (!claudeSessionId) return;
  try {
    await fetch(`${url}/api/sessions/${sessionId}/claude-session`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claudeSessionId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {}
}

/**
 * Messages sent *to* this session that it hasn't consumed yet — replies typed
 * into the dashboard and broadcasts from other sessions.
 *
 * A session's own progress messages are excluded: those came from Claude, and
 * handing them back would be an echo chamber. Never throws.
 */
export async function pendingInbox(url, sessionId) {
  try {
    const resp = await fetch(`${url}/api/sessions/${sessionId}/messages/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unreadOnly: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) return [];
    const messages = await resp.json();
    if (!Array.isArray(messages)) return [];
    return messages.filter((m) => m.from === "user" || m.from === "broadcast");
  } catch {
    return [];
  }
}

/**
 * Mark messages consumed.
 *
 * Load-bearing rather than housekeeping: without it the same message is
 * pending forever, and anything that injects the inbox would re-inject it on
 * every turn. Never throws.
 */
export async function markRead(url, sessionId, messageIds) {
  if (!messageIds.length) return;
  try {
    await fetch(`${url}/api/sessions/${sessionId}/messages/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageIds }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {}
}

/** Unregister a session from the hive. Never throws. */
export async function deleteSession(url, sessionId) {
  try {
    await fetch(`${url}/api/sessions/${sessionId}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {}
}

/** Drop this Claude Code session's claim and pending flag. */
export function releaseClaim(event) {
  const key = claimKey(event);
  if (key !== null) removeFile(claimPathFor(key));
  removeFile(pendingPath(event));
}

/** Exposed for tests. */
export const _internals = { claimDir, claimPathFor, normalizeDir };
