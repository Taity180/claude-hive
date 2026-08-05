import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { resolveSession, releaseClaim, pendingPath, claimKey } from "./hive.mjs";

const CWD = "C:\\repos\\my-app";

function session(id, overrides = {}) {
  return {
    id,
    workingDirectory: CWD,
    status: "running",
    connectedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Stub the hive's GET /api/sessions with a fixed list. */
function stubSessions(sessions) {
  return vi.fn(async (url) => {
    if (String(url).endsWith("/api/sessions")) {
      return { ok: true, json: async () => sessions };
    }
    return { ok: true, json: async () => ({}) };
  });
}

let stateDir;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "hive-hooks-"));
  process.env.CLAUDE_HIVE_STATE_DIR = stateDir;
});

afterEach(() => {
  delete process.env.CLAUDE_HIVE_STATE_DIR;
  rmSync(stateDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("resolveSession", () => {
  it("claims the only session in the working directory", async () => {
    vi.stubGlobal("fetch", stubSessions([session("hive-1")]));

    const resolved = await resolveSession({ session_id: "claude-a", cwd: CWD });

    expect(resolved?.id).toBe("hive-1");
  });

  it("matches working directories across path separators and case", async () => {
    vi.stubGlobal("fetch", stubSessions([session("hive-1", { workingDirectory: "c:/repos/My-App/" })]));

    const resolved = await resolveSession({ session_id: "claude-a", cwd: CWD });

    expect(resolved?.id).toBe("hive-1");
  });

  it("gives two Claude sessions in one repo different hive sessions", async () => {
    const sessions = [session("hive-1"), session("hive-2", { connectedAt: "2026-01-01T00:00:05Z" })];
    vi.stubGlobal("fetch", stubSessions(sessions));

    const first = await resolveSession({ session_id: "claude-a", cwd: CWD });
    const second = await resolveSession({ session_id: "claude-b", cwd: CWD });

    expect(first?.id).toBe("hive-1");
    expect(second?.id).toBe("hive-2");
  });

  it("returns the same session on every later call", async () => {
    const sessions = [session("hive-1"), session("hive-2")];
    vi.stubGlobal("fetch", stubSessions(sessions));

    const event = { session_id: "claude-a", cwd: CWD };
    await resolveSession(event);
    // A rival claims the other slot in between.
    await resolveSession({ session_id: "claude-b", cwd: CWD });

    expect((await resolveSession(event))?.id).toBe("hive-1");
  });

  it("returns null when every matching session is already claimed", async () => {
    vi.stubGlobal("fetch", stubSessions([session("hive-1")]));

    await resolveSession({ session_id: "claude-a", cwd: CWD });
    const second = await resolveSession({ session_id: "claude-b", cwd: CWD });

    expect(second).toBeNull();
  });

  it("re-claims when the hive restarts and hands out new ids", async () => {
    const event = { session_id: "claude-a", cwd: CWD };

    vi.stubGlobal("fetch", stubSessions([session("hive-old")]));
    expect((await resolveSession(event))?.id).toBe("hive-old");

    vi.stubGlobal("fetch", stubSessions([session("hive-new")]));
    expect((await resolveSession(event))?.id).toBe("hive-new");
  });

  it("frees a slot held by a claim the hive no longer knows about", async () => {
    // A crashed session claimed hive-gone, which is no longer registered.
    vi.stubGlobal("fetch", stubSessions([session("hive-gone")]));
    await resolveSession({ session_id: "claude-dead", cwd: CWD });

    vi.stubGlobal("fetch", stubSessions([session("hive-1")]));
    const resolved = await resolveSession({ session_id: "claude-b", cwd: CWD });

    expect(resolved?.id).toBe("hive-1");
  });

  it("ignores sessions from other working directories", async () => {
    vi.stubGlobal("fetch", stubSessions([session("hive-1", { workingDirectory: "C:\\repos\\other" })]));

    expect(await resolveSession({ session_id: "claude-a", cwd: CWD })).toBeNull();
  });

  it("returns null when the hive is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));

    expect(await resolveSession({ session_id: "claude-a", cwd: CWD })).toBeNull();
  });

  describe("requireUnambiguous (SessionEnd)", () => {
    it("refuses to claim when two unclaimed sessions share the directory", async () => {
      vi.stubGlobal("fetch", stubSessions([session("hive-1"), session("hive-2")]));

      const resolved = await resolveSession(
        { session_id: "claude-a", cwd: CWD },
        { requireUnambiguous: true },
      );

      expect(resolved).toBeNull();
    });

    it("still honours a claim this session already made", async () => {
      vi.stubGlobal("fetch", stubSessions([session("hive-1"), session("hive-2")]));
      const event = { session_id: "claude-a", cwd: CWD };
      await resolveSession(event);

      const resolved = await resolveSession(event, { requireUnambiguous: true });

      expect(resolved?.id).toBe("hive-1");
    });
  });
});

describe("releaseClaim", () => {
  it("removes the claim and pending flag so the slot is reusable", async () => {
    vi.stubGlobal("fetch", stubSessions([session("hive-1")]));
    const event = { session_id: "claude-a", cwd: CWD };
    await resolveSession(event);

    const claimFile = join(stateDir, `${claimKey(event)}.session`);
    expect(readFileSync(claimFile, "utf8")).toBe("hive-1");

    releaseClaim(event);

    expect(existsSync(claimFile)).toBe(false);
    expect(existsSync(pendingPath(event))).toBe(false);
    expect((await resolveSession({ session_id: "claude-b", cwd: CWD }))?.id).toBe("hive-1");
  });
});

describe("claimKey", () => {
  it("sanitises the Claude session id into a safe filename", () => {
    expect(claimKey({ session_id: "a/b\\c:d" })).toBe("a_b_c_d");
  });

  it("is null when the payload carries no session id", () => {
    expect(claimKey({ cwd: CWD })).toBeNull();
  });
});

describe("payloads without a session id", () => {
  // Nothing unique to key a claim on, so these hooks must not claim at all —
  // a directory-derived key would be shared by every session in the repo,
  // which is the bug the claim mechanism exists to prevent.
  const noId = { cwd: CWD };

  it("still resolves when a single session matches the directory", async () => {
    vi.stubGlobal("fetch", stubSessions([session("hive-1")]));

    expect((await resolveSession(noId))?.id).toBe("hive-1");
  });

  it("writes no claim file", async () => {
    vi.stubGlobal("fetch", stubSessions([session("hive-1")]));
    await resolveSession(noId);

    expect(readdirSync(stateDir).filter((f) => f.endsWith(".session"))).toEqual([]);
  });

  it("refuses to resolve when the directory holds more than one session", async () => {
    vi.stubGlobal("fetch", stubSessions([session("hive-1"), session("hive-2")]));

    expect(await resolveSession(noId)).toBeNull();
  });

  it("does not steal a session already claimed by an identified sibling", async () => {
    vi.stubGlobal("fetch", stubSessions([session("hive-1")]));
    await resolveSession({ session_id: "claude-a", cwd: CWD });

    expect(await resolveSession(noId)).toBeNull();
  });

  it("keeps a working pending flag path", () => {
    expect(pendingPath(noId)).toContain(".pending");
    expect(pendingPath(noId)).not.toContain("null");
  });
});
