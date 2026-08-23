import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("./hooks/useWebSocket", () => ({ useWebSocket: () => {} }));
vi.mock("./hooks/useTheme", () => ({
  useTheme: () => ({ theme: { id: "default" }, setTheme: () => {} }),
}));
vi.mock("./hooks/useAgentData", () => ({ useAgentData: () => {} }));
vi.mock("./hooks/useRailResize", () => ({ useRailResize: () => {} }));
vi.mock("../agentApi", () => ({}));
vi.mock("./agentApi", () => ({
  createTask: vi.fn().mockResolvedValue(true),
  setTaskDone: vi.fn().mockResolvedValue(true),
  addTaskNote: vi.fn().mockResolvedValue(true),
  replyToAgent: vi.fn().mockResolvedValue(true),
  fetchPendingReplies: vi.fn().mockResolvedValue(0),
  fetchConnectionInfo: vi.fn().mockResolvedValue(null),
  setAgentEnabled: vi.fn().mockResolvedValue(true),
}));

import { invoke } from "@tauri-apps/api/core";
import { Rail } from "./Rail";
import { useRailStore } from "./stores/railStore";
import { useHubStore } from "./stores/hubStore";

const invokeMock = vi.mocked(invoke);

describe("Rail", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockClear().mockResolvedValue(null);
    useRailStore.setState(useRailStore.getInitialState(), true);
    useHubStore.setState({
      sessions: [],
      agentApps: [],
      agentPosts: [],
      agents: [],
      tasks: [],
      unreadSessions: new Set(),
    });
  });

  it("rests as a nub until opened", () => {
    render(<Rail />);
    expect(screen.queryByTestId("pane-feed")).toBeNull();
  });

  it("shows the four rail panes when opened on its own", () => {
    useRailStore.setState({ open: true });
    render(<Rail />);
    expect(screen.getByTestId("pane-feed")).toBeInTheDocument();
    expect(screen.queryByTestId("detach-hive")).toBeNull();
  });

  it("hosts Hive's panes when combined, instead of the tab strip", () => {
    // Combined mode moves Hive *into* the rail. It used to close the rail
    // instead and host the panes in Hive, which looked like the toggle doing
    // nothing at all.
    useRailStore.setState({ open: true, combined: true });
    render(<Rail />);
    expect(screen.getByRole("button", { name: /^Sessions/ })).toBeInTheDocument();
    expect(screen.getByTestId("detach-hive")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-feed")).toBeNull();
  });

  it("shows and opens itself when combined mode turns on", async () => {
    render(<Rail />);
    act(() => useRailStore.getState().setCombined(true));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("open_rail"));
    expect(useRailStore.getState().open).toBe(true);
    expect(invokeMock).not.toHaveBeenCalledWith("close_rail");
  });
});
