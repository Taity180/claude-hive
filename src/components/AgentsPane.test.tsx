import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchConnectionInfo, setAgentEnabled } = vi.hoisted(() => ({
  fetchConnectionInfo: vi.fn(),
  setAgentEnabled: vi.fn(),
}));
vi.mock("../agentApi", () => ({ fetchConnectionInfo, setAgentEnabled }));

import { AgentsPane } from "./AgentsPane";
import { useHubStore } from "../stores/hubStore";

const connection = {
  endpoint: "http://127.0.0.1:9400/mcp",
  token: "hive_ag_abc123",
  promptBlock: "You are connected to Claude Hive… agent_post … agent_inbox",
};

describe("AgentsPane", () => {
  beforeEach(() => {
    fetchConnectionInfo.mockReset().mockResolvedValue(connection);
    setAgentEnabled.mockReset().mockResolvedValue(true);
    useHubStore.setState({
      agents: [
        {
          id: "a1",
          name: "Grok",
          version: "2.1",
          connectedAt: "",
          lastSeen: "",
          enabled: true,
        },
      ],
      agentApps: [
        { agentId: "a1", agentName: "Grok", id: "gmail", label: "Gmail", health: "ok" },
      ],
    });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("shows the endpoint the server is actually listening on", async () => {
    render(<AgentsPane />);
    await waitFor(() =>
      expect(screen.getByTestId("agents-endpoint")).toHaveTextContent(
        "http://127.0.0.1:9400/mcp"
      )
    );
  });

  it("shows a token and the prompt block", async () => {
    render(<AgentsPane />);
    await waitFor(() => expect(screen.getByTestId("agents-token")).toBeInTheDocument());
    expect(screen.getByTestId("agents-prompt")).toHaveTextContent("agent_post");
  });

  it("copies the token to the clipboard", async () => {
    render(<AgentsPane />);
    await waitFor(() => expect(screen.getByTestId("agents-token")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /copy token/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hive_ag_abc123");
  });

  it("lists connected agents with their apps", async () => {
    render(<AgentsPane />);
    await waitFor(() => expect(screen.getByTestId("agent-row")).toBeInTheDocument());
    expect(screen.getByText("Grok")).toBeInTheDocument();
    expect(screen.getByText(/1 app/i)).toBeInTheDocument();
  });

  it("mutes an agent", async () => {
    render(<AgentsPane />);
    await waitFor(() => expect(screen.getByTestId("agent-row")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /mute grok/i }));
    expect(setAgentEnabled).toHaveBeenCalledWith("a1", false);
  });

  it("explains that connecting alone is not enough", async () => {
    // The single most important thing in this pane: an agent that is merely
    // connected posts nothing.
    render(<AgentsPane />);
    await waitFor(() => expect(screen.getByTestId("agents-prompt")).toBeInTheDocument());
    expect(screen.getByText(/paste/i)).toBeInTheDocument();
  });

  it("says so when no agent has ever connected", async () => {
    useHubStore.setState({ agents: [], agentApps: [] });
    render(<AgentsPane />);
    await waitFor(() => expect(screen.getByTestId("agents-endpoint")).toBeInTheDocument());
    expect(screen.getByText(/no agents connected yet/i)).toBeInTheDocument();
  });

  it("degrades to a message when the server is unreachable", async () => {
    fetchConnectionInfo.mockResolvedValue(null);
    render(<AgentsPane />);
    await waitFor(() =>
      expect(screen.getByText(/could not reach hive/i)).toBeInTheDocument()
    );
  });
});
