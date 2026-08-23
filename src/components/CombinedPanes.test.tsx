import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

vi.mock("../agentApi", () => ({
  createTask: vi.fn().mockResolvedValue(true),
  setTaskDone: vi.fn().mockResolvedValue(true),
  addTaskNote: vi.fn().mockResolvedValue(true),
  replyToAgent: vi.fn().mockResolvedValue(true),
  fetchPendingReplies: vi.fn().mockResolvedValue(0),
  fetchConnectionInfo: vi.fn().mockResolvedValue(null),
  setAgentEnabled: vi.fn().mockResolvedValue(true),
}));

import { CombinedPanes } from "./CombinedPanes";
import { useHubStore } from "../stores/hubStore";
import { useRailStore } from "../stores/railStore";

const openTask = {
  id: "t1",
  externalId: null,
  agentId: null,
  title: "a",
  appId: null,
  sourceLabel: null,
  due: null,
  done: false,
  completedBy: null,
  completedAt: null,
  notes: [],
  createdAt: "",
  updatedAt: "",
};

describe("CombinedPanes", () => {
  beforeEach(() => {
    invoke.mockClear().mockResolvedValue(undefined);
    localStorage.clear();
    useRailStore.setState(useRailStore.getInitialState(), true);
    useHubStore.setState({
      viewState: "expanded",
      activeSessionId: null,
      sessions: [],
      agentApps: [],
      agentPosts: [],
      agents: [],
      tasks: [],
      unreadSessions: new Set(),
    });
  });

  it("groups the sidebar into what Hive brings and what the rail does", () => {
    render(<CombinedPanes />);
    expect(screen.getByText("Hive")).toBeInTheDocument();
    expect(screen.getByText("Rail")).toBeInTheDocument();
  });

  it("keeps the connector strip above every pane, not just the feed", async () => {
    useHubStore.setState({
      agentApps: [
        { agentId: "a1", agentName: "Grok Bot", id: "gmail", label: "Gmail", health: "ok" },
      ] as never,
    });
    render(<CombinedPanes />);
    // Sessions is the pane on open, and the strip has to be there too.
    expect(screen.getByTitle(/Gmail/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Tasks/ }));
    expect(screen.getByTitle(/Gmail/)).toBeInTheDocument();
  });

  it("shows a sidebar entry per pane", () => {
    render(<CombinedPanes />);
    for (const label of ["Sessions", "All activity", "Tasks", "Agents", "Settings"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
  });

  it("switches pane", async () => {
    render(<CombinedPanes />);
    await userEvent.click(screen.getByRole("button", { name: /^Tasks/ }));
    expect(screen.getByTestId("task-add-input")).toBeInTheDocument();
  });

  it("counts open tasks in the sidebar", () => {
    useHubStore.setState({ tasks: [openTask] });
    render(<CombinedPanes />);
    expect(screen.getByTestId("sidebar-count-tasks")).toHaveTextContent("1");
  });

  it("shows no count when there is nothing outstanding", () => {
    render(<CombinedPanes />);
    expect(screen.queryByTestId("sidebar-count-tasks")).toBeNull();
  });

  it("counts sessions needing attention", () => {
    useHubStore.setState({
      sessions: [
        { sessionHandle: 1, status: "waiting_for_input" },
        { sessionHandle: 2, status: "idle" },
      ] as never,
    });
    render(<CombinedPanes />);
    expect(screen.getByTestId("sidebar-count-sessions")).toHaveTextContent("1");
  });

  it("marks the active pane", () => {
    render(<CombinedPanes />);
    const pressed = screen
      .getAllByTestId("sidebar-item")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
  });

  it("follows Hive's own navigation instead of leaving a dead click", async () => {
    // The dashboard's rows set viewState; if the pane only ever rendered the
    // dashboard, clicking a session would change state and show nothing.
    useHubStore.setState({ viewState: "settings" });
    render(<CombinedPanes />);
    expect(screen.getByTestId("hive-pane-back")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("hive-pane-back"));
    expect(useHubStore.getState().viewState).toBe("expanded");
    expect(screen.queryByTestId("hive-pane-back")).toBeNull();
  });
});
