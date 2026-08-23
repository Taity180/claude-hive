import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchAgents, fetchAgentApps, fetchAgentPosts, fetchAgentQuestions, fetchTasks } =
  vi.hoisted(() => ({
    fetchAgents: vi.fn(),
    fetchAgentApps: vi.fn(),
    fetchAgentPosts: vi.fn(),
    fetchAgentQuestions: vi.fn(),
    fetchTasks: vi.fn(),
  }));
vi.mock("../agentApi", () => ({
  fetchAgents,
  fetchAgentApps,
  fetchAgentPosts,
  fetchAgentQuestions,
  fetchTasks,
}));

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
    fetchAgentQuestions.mockReset().mockResolvedValue([
      {
        id: "q1",
        agentId: "a1",
        agentName: "Grok",
        appId: null,
        question: "Now?",
        options: ["Yes", "No"],
        askedAt: "",
        answer: null,
        answeredAt: null,
      },
    ]);
    fetchTasks.mockReset().mockResolvedValue([]);
    useHubStore.setState({
      agents: [],
      agentApps: [],
      agentPosts: [],
      agentQuestions: [],
      tasks: [],
    });
  });

  it("loads agents, apps and posts into the store", async () => {
    renderHook(() => useAgentData());
    await waitFor(() => expect(useHubStore.getState().agents).toHaveLength(1));
    expect(useHubStore.getState().agentApps).toHaveLength(1);
    expect(fetchAgentPosts).toHaveBeenCalled();
    expect(fetchTasks).toHaveBeenCalled();
    // A question asked before the rail's webview connected must still show up.
    expect(useHubStore.getState().agentQuestions).toHaveLength(1);
  });

  it("fetches once, not on every render", async () => {
    const { rerender } = renderHook(() => useAgentData());
    await waitFor(() => expect(fetchAgents).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    expect(fetchAgents).toHaveBeenCalledTimes(1);
  });
});
