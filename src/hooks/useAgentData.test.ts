import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchAgents, fetchAgentApps, fetchAgentPosts } = vi.hoisted(() => ({
  fetchAgents: vi.fn(),
  fetchAgentApps: vi.fn(),
  fetchAgentPosts: vi.fn(),
}));
vi.mock("../agentApi", () => ({ fetchAgents, fetchAgentApps, fetchAgentPosts }));

import { useAgentData } from "./useAgentData";
import { useHubStore } from "../stores/hubStore";

describe("useAgentData", () => {
  beforeEach(() => {
    fetchAgents.mockReset().mockResolvedValue([
      { id: "a1", name: "Grok", version: null, connectedAt: "", lastSeen: "", enabled: true },
    ]);
    fetchAgentApps.mockReset().mockResolvedValue([
      { agentId: "a1", agentName: "Grok", id: "gmail", label: "Gmail", health: "ok" },
    ]);
    fetchAgentPosts.mockReset().mockResolvedValue([]);
    useHubStore.setState({ agents: [], agentApps: [], agentPosts: [] });
  });

  it("loads agents, apps and posts into the store", async () => {
    renderHook(() => useAgentData());
    await waitFor(() => expect(useHubStore.getState().agents).toHaveLength(1));
    expect(useHubStore.getState().agentApps).toHaveLength(1);
    expect(fetchAgentPosts).toHaveBeenCalled();
  });

  it("fetches once, not on every render", async () => {
    const { rerender } = renderHook(() => useAgentData());
    await waitFor(() => expect(fetchAgents).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    expect(fetchAgents).toHaveBeenCalledTimes(1);
  });
});
