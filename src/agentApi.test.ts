import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { baseUrl: "http://localhost:9400" } }));

import {
  fetchAgents,
  fetchAgentApps,
  fetchAgentPosts,
  fetchConnectionInfo,
  replyToAgent,
  fetchPendingReplies,
} from "./agentApi";

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function ok(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

/**
 * Run `body` with a fetch that always fails, then restore.
 *
 * A plain swap rather than a vi mock: sharing one mock across the ok and the
 * failing tests made vitest surface the intended failure as a file-level
 * unhandled error, failing every test in the file even though the code under
 * test catches correctly. Nothing here touches mock state.
 */
async function whileUnreachable(body: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = original;
  }
}

describe("agent api", () => {
  beforeEach(() => fetchMock.mockClear());

  it("lists agents", async () => {
    fetchMock.mockReturnValue(ok([{ id: "a1", name: "Grok" }]));
    const agents = await fetchAgents();
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9400/api/agents");
    expect(agents[0].name).toBe("Grok");
  });

  it("passes appId and limit as query params", async () => {
    fetchMock.mockReturnValue(ok([]));
    await fetchAgentPosts("gmail", 20);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("appId=gmail");
    expect(url).toContain("limit=20");
  });

  it("omits appId when asking for the global feed", async () => {
    fetchMock.mockReturnValue(ok([]));
    await fetchAgentPosts();
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("appId");
  });

  it("posts a reply as JSON", async () => {
    fetchMock.mockReturnValue(ok({}));
    await replyToAgent("a1", "dig into it");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:9400/api/agents/a1/reply");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      message: "dig into it",
    });
  });

  it("reads the pending reply count", async () => {
    fetchMock.mockReturnValue(ok({ pending: 3 }));
    expect(await fetchPendingReplies("a1")).toBe(3);
  });

  it("treats a non-ok response as empty rather than throwing", async () => {
    fetchMock.mockReturnValue(Promise.resolve({ ok: false } as Response));
    expect(await fetchAgents()).toEqual([]);
  });

  it("returns an empty list rather than throwing when the server is unreachable", async () => {
    // Hive's own window loads before the server is guaranteed up; a rejected
    // fetch must not blank the rail.
    await whileUnreachable(async () => {
      expect(await fetchAgents()).toEqual([]);
      expect(await fetchAgentApps()).toEqual([]);
      expect(await fetchAgentPosts()).toEqual([]);
    });
  });

  it("returns null connection info when the server is unreachable", async () => {
    await whileUnreachable(async () => {
      expect(await fetchConnectionInfo()).toBeNull();
    });
  });

  it("reports a failed send as false so the composer can keep the text", async () => {
    await whileUnreachable(async () => {
      expect(await replyToAgent("a1", "important")).toBe(false);
    });
  });
});
