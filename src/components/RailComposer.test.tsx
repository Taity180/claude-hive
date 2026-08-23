import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replyToAgent, fetchPendingReplies } = vi.hoisted(() => ({
  replyToAgent: vi.fn(),
  fetchPendingReplies: vi.fn(),
}));
vi.mock("../agentApi", () => ({ replyToAgent, fetchPendingReplies }));

import { RailComposer } from "./RailComposer";
import type { Agent } from "../types";

const agents: Agent[] = [
  {
    id: "a1",
    name: "Grok",
    version: null,
    connectedAt: "",
    lastSeen: "",
    enabled: true,
  },
];

describe("RailComposer", () => {
  beforeEach(() => {
    replyToAgent.mockReset().mockResolvedValue(true);
    fetchPendingReplies.mockReset().mockResolvedValue(0);
  });

  it("targets the only connected agent", () => {
    render(<RailComposer agents={agents} />);
    expect(screen.getByTestId("composer-target")).toHaveTextContent("Grok");
  });

  it("sends what was typed and clears the field", async () => {
    render(<RailComposer agents={agents} />);
    await userEvent.type(screen.getByTestId("composer-input"), "dig into it");
    await userEvent.click(screen.getByTestId("composer-send"));

    expect(replyToAgent).toHaveBeenCalledWith("a1", "dig into it");
    await waitFor(() => expect(screen.getByTestId("composer-input")).toHaveValue(""));
  });

  it("will not send an empty or whitespace message", async () => {
    render(<RailComposer agents={agents} />);
    await userEvent.click(screen.getByTestId("composer-send"));
    await userEvent.type(screen.getByTestId("composer-input"), "   ");
    await userEvent.click(screen.getByTestId("composer-send"));
    expect(replyToAgent).not.toHaveBeenCalled();
  });

  it("says a reply is queued, because MCP cannot push it", async () => {
    // An honest "waiting to be collected" beats a send button that pretends to
    // be instant — the agent may not run again for a while.
    fetchPendingReplies.mockResolvedValue(2);
    render(<RailComposer agents={agents} />);
    await waitFor(() =>
      expect(screen.getByTestId("composer-queued")).toHaveTextContent("2")
    );
    expect(screen.getByTestId("composer-queued").textContent).toMatch(/collect|queued/i);
  });

  it("hides the queue line when nothing is waiting", async () => {
    fetchPendingReplies.mockResolvedValue(0);
    render(<RailComposer agents={agents} />);
    await waitFor(() => expect(fetchPendingReplies).toHaveBeenCalled());
    expect(screen.queryByTestId("composer-queued")).toBeNull();
  });

  it("disables itself when no agent has connected", () => {
    render(<RailComposer agents={[]} />);
    expect(screen.getByTestId("composer-send")).toBeDisabled();
    expect(screen.getByTestId("composer-target")).toHaveTextContent(/no agent/i);
  });

  it("does not ask for a pending count when there is no agent", () => {
    render(<RailComposer agents={[]} />);
    expect(fetchPendingReplies).not.toHaveBeenCalled();
  });

  it("keeps the text when sending fails, so the user does not lose it", async () => {
    replyToAgent.mockResolvedValue(false);
    render(<RailComposer agents={agents} />);
    await userEvent.type(screen.getByTestId("composer-input"), "important");
    await userEvent.click(screen.getByTestId("composer-send"));
    await waitFor(() => expect(replyToAgent).toHaveBeenCalled());
    expect(screen.getByTestId("composer-input")).toHaveValue("important");
  });

  it("sends on Enter", async () => {
    render(<RailComposer agents={agents} />);
    await userEvent.type(screen.getByTestId("composer-input"), "quick{Enter}");
    expect(replyToAgent).toHaveBeenCalledWith("a1", "quick");
  });
});
