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
 * Stable per-Claude-Code-session key used to name claim files. Falls back to
 * the working directory so a payload without a session_id still gets a key,
 * just a coarser one.
 */
export function claimKey(event) {
  const raw = event?.session_id || `cwd-${eventCwd(event)}`;
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

/** Path of this session's "a permission prompt is pending" flag. */
export function pendingPath(event) {
  return join(claimDir(), `${claimKey(event)}.pending`);
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
 *   one unclaimed session matches this working directory.
 * @returns {Promise<{id: string, session: object, url: string} | null>}
 */
export async function resolveSession(event, options = {}) {
  const { claim = true, requireUnambiguous = false } = options;
  const url = hiveUrl();

  const sessions = await fetchSessions(url);
  if (!sessions) return null;

  const byId = new Map(sessions.map((s) => [s.id, s]));
  const key = claimKey(event);
  const path = claimPathFor(key);

  // An existing claim wins as long as the hive still knows that session.
  const claimed = readFileOrNull(path);
  if (claimed) {
    const session = byId.get(claimed);
    if (session) return { id: claimed, session, url };
    // Hive restarted and handed out fresh ids — drop the claim and re-claim.
    removeFile(path);
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
  if (!writeClaim(key, chosen.id)) return null;

  // Two sessions starting at the same instant can both pick the same slot.
  // Settle it deterministically: the lexicographically smallest claim key
  // keeps it, the other steps aside to the next free session.
  const rivals = otherClaims(key, new Set(byId.keys()));
  const rivalKey = rivals.get(chosen.id);
  if (rivalKey && rivalKey < key) {
    removeFile(path);
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
  removeFile(claimPathFor(claimKey(event)));
  removeFile(pendingPath(event));
}

/** Exposed for tests. */
export const _internals = { claimDir, claimPathFor, normalizeDir };
