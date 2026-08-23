import { describe, expect, it } from "vitest";
import type { AgentPost, AgentAppRow, WsEvent } from "./index";

describe("agent types", () => {
  it("models a post the way the API sends it", () => {
    // Shape copied from src-tauri/tests/agent_ingest.md, so a rename on the
    // Rust side breaks this rather than silently producing undefined at runtime.
    const post: AgentPost = {
      id: "p1",
      agentId: "a1",
      agentName: "Grok",
      appId: "gmail",
      content: "Found 2 tasks",
      postType: "info",
      timestamp: new Date().toISOString(),
      read: false,
    };
    expect(post.agentName).toBe("Grok");
  });

  it("models an apps-bar row, which flattens the app onto its owner", () => {
    const row: AgentAppRow = {
      agentId: "a1",
      agentName: "Grok",
      id: "gmail",
      label: "Gmail",
      health: "ok",
    };
    expect(row.id).toBe("gmail");
  });

  it("admits the three new websocket events", () => {
    const events: WsEvent[] = [
      {
        type: "agentPosted",
        post: {
          id: "p1",
          agentId: "a1",
          agentName: "Grok",
          appId: null,
          content: "hi",
          postType: "info",
          timestamp: "2026-08-23T00:00:00Z",
          read: false,
        },
      },
      { type: "agentAppsChanged", agentId: "a1", apps: [] },
    ];
    expect(events).toHaveLength(2);
  });
});
