import { describe, expect, it } from "vitest";
import { buildFeed } from "./buildFeed";
import type { AgentPost, Session } from "../types";

const t = (minutes: number) => new Date(Date.UTC(2026, 7, 23, 12, minutes)).toISOString();

function session(id: string, status: Session["status"], at: string): Session {
  return { id, projectName: id, status, lastActivity: at } as Session;
}

function post(id: string, at: string, appId: string | null = null): AgentPost {
  return {
    id,
    agentId: "a1",
    agentName: "Grok",
    appId,
    content: id,
    postType: "info",
    timestamp: at,
    read: false,
  };
}

describe("buildFeed", () => {
  it("interleaves sessions and posts newest first", () => {
    const rows = buildFeed(
      [session("s-old", "running", t(0)), session("s-new", "running", t(30))],
      [post("p-mid", t(15))]
    );
    expect(rows.map((r) => (r.kind === "session" ? r.session.id : r.post.id))).toEqual([
      "s-new",
      "p-mid",
      "s-old",
    ]);
  });

  it("pins a session needing attention above everything newer", () => {
    // The whole point of the rail is a glance. A blocked session must not be
    // buried by an agent that posts every few seconds.
    const rows = buildFeed(
      [session("blocked", "waiting_for_input", t(0))],
      [post("chatty", t(59))],
      { pinAttention: true }
    );
    expect(rows[0].kind).toBe("session");
    expect(rows[0].kind === "session" && rows[0].session.id).toBe("blocked");
  });

  it("pins an errored session too, matching the rest of the app", () => {
    const rows = buildFeed([session("broken", "error", t(0))], [post("chatty", t(59))], {
      pinAttention: true,
    });
    expect(rows[0].kind === "session" && rows[0].session.id).toBe("broken");
  });

  it("does not pin when the setting is off", () => {
    const rows = buildFeed(
      [session("blocked", "waiting_for_input", t(0))],
      [post("chatty", t(59))],
      { pinAttention: false }
    );
    expect(rows[0].kind).toBe("post");
  });

  it("orders two attention sessions among themselves by recency", () => {
    const rows = buildFeed(
      [session("older", "waiting_for_input", t(0)), session("newer", "error", t(10))],
      [],
      { pinAttention: true }
    );
    expect(rows[0].kind === "session" && rows[0].session.id).toBe("newer");
  });

  it("keeps every row when pinning, not just the pinned ones", () => {
    const rows = buildFeed(
      [session("blocked", "waiting_for_input", t(0)), session("busy", "running", t(20))],
      [post("p1", t(30))],
      { pinAttention: true }
    );
    expect(rows).toHaveLength(3);
  });

  it("filters to one app, dropping sessions entirely", () => {
    // A per-app view is about that app, so a Claude session has no place in it.
    const rows = buildFeed(
      [session("s1", "running", t(30))],
      [post("gmail-1", t(10), "gmail"), post("x-1", t(20), "x")],
      { appId: "gmail" }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind === "post" && rows[0].post.id).toBe("gmail-1");
  });

  it("returns nothing for an app with no posts rather than falling back to everything", () => {
    const rows = buildFeed([session("s1", "running", t(30))], [post("x-1", t(20), "x")], {
      appId: "gmail",
    });
    expect(rows).toEqual([]);
  });

  it("excludes posts with no app from a per-app view", () => {
    const rows = buildFeed([], [post("no-app", t(10), null), post("gmail-1", t(5), "gmail")], {
      appId: "gmail",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind === "post" && rows[0].post.id).toBe("gmail-1");
  });

  it("handles empty input", () => {
    expect(buildFeed([], [])).toEqual([]);
  });

  it("tolerates a missing timestamp without dropping the row", () => {
    const broken = { ...post("p1", t(10)), timestamp: "" };
    const rows = buildFeed([], [broken]);
    expect(rows).toHaveLength(1);
  });
});
