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

import { RailPanes } from "./RailPanes";
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

describe("RailPanes", () => {
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

  it("shows only the rail's own panes until Hive moves in", () => {
    render(<RailPanes />);
    expect(screen.getByText("Rail")).toBeInTheDocument();
    expect(screen.queryByText("Hive")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Sessions/ })).toBeNull();
  });

  it("adds Hive's group when combined", () => {
    useRailStore.getState().setCombined(true);
    render(<RailPanes />);
    expect(screen.getByText("Hive")).toBeInTheDocument();
    expect(screen.getByText("Rail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Sessions/ })).toBeInTheDocument();
  });

  it("keeps the connector strip above every pane, not just the feed", async () => {
    useRailStore.getState().setCombined(true);
    useHubStore.setState({
      agentApps: [
        { agentId: "a1", agentName: "Grok Bot", id: "gmail", label: "Gmail", health: "ok" },
      ] as never,
    });
    render(<RailPanes />);
    // Sessions is the pane on open, and the strip has to be there too.
    expect(screen.getByTitle(/Gmail/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Tasks/ }));
    expect(screen.getByTitle(/Gmail/)).toBeInTheDocument();
  });

  it("shows a sidebar entry per pane", () => {
    useRailStore.getState().setCombined(true);
    render(<RailPanes />);
    for (const label of ["Sessions", "All activity", "Tasks", "Agents", "Settings"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
  });

  it("switches pane", async () => {
    render(<RailPanes />);
    await userEvent.click(screen.getByRole("button", { name: /^Tasks/ }));
    expect(screen.getByTestId("task-add-input")).toBeInTheDocument();
  });

  it("counts open tasks in the sidebar", () => {
    useHubStore.setState({ tasks: [openTask] });
    render(<RailPanes />);
    expect(screen.getByTestId("sidebar-count-tasks")).toHaveTextContent("1");
  });

  it("shows no count when there is nothing outstanding", () => {
    render(<RailPanes />);
    expect(screen.queryByTestId("sidebar-count-tasks")).toBeNull();
  });

  it("counts sessions needing attention", () => {
    useRailStore.getState().setCombined(true);
    useRailStore.getState().setLastPane("sessions");
    useHubStore.setState({
      sessions: [
        { sessionHandle: 1, status: "waiting_for_input" },
        { sessionHandle: 2, status: "idle" },
      ] as never,
    });
    render(<RailPanes />);
    expect(screen.getByTestId("sidebar-count-sessions")).toHaveTextContent("1");
  });

  it("marks the active pane", () => {
    render(<RailPanes />);
    const pressed = screen
      .getAllByTestId("sidebar-item")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
  });

  it("follows Hive's own navigation instead of leaving a dead click", async () => {
    useRailStore.getState().setCombined(true);
    useRailStore.getState().setLastPane("sessions");
    // The dashboard's rows set viewState; if the pane only ever rendered the
    // dashboard, clicking a session would change state and show nothing.
    useHubStore.setState({ viewState: "settings" });
    render(<RailPanes />);
    expect(screen.getByTestId("hive-pane-back")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("hive-pane-back"));
    expect(useHubStore.getState().viewState).toBe("expanded");
    expect(screen.queryByTestId("hive-pane-back")).toBeNull();
  });

  it("expands Settings into its children when it is the pane", async () => {
    render(<RailPanes />);
    expect(screen.queryByText("Appearance")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    for (const child of ["Position", "Behaviour", "Appearance", "Muted apps", "Plugin setup"]) {
      expect(screen.getByRole("button", { name: child })).toBeInTheDocument();
    }
    // Settings opens on the first child rather than a blank pane.
    expect(screen.getAllByTestId("anchor-option").length).toBeGreaterThan(0);
  });

  it("keeps Settings marked while one of its children is showing", async () => {
    render(<RailPanes />);
    await userEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    await userEvent.click(screen.getByRole("button", { name: "Appearance" }));

    const parent = screen.getByRole("button", { name: /^Settings/ });
    expect(parent).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Window opacity")).toBeInTheDocument();
  });

  it("carries Hive's theme in the rail's appearance settings", async () => {
    // It was a Hive-only screen; the palette is shared by both windows, so it
    // belongs with the rail's own appearance settings.
    render(<RailPanes />);
    await userEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    await userEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.getByText("Theme")).toBeInTheDocument();
  });

  it("collapses the children again when another pane is chosen", async () => {
    render(<RailPanes />);
    await userEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Tasks/ }));
    expect(screen.queryByRole("button", { name: "Appearance" })).toBeNull();
  });

  it("comes back to the pane it was left on", () => {
    // The rail collapses whenever the cursor leaves, so landing somewhere else
    // each time would lose the reader's place several times an hour.
    useRailStore.getState().setLastPane("settings:appearance");
    render(<RailPanes />);
    expect(screen.getByLabelText("Window opacity")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("remembers the pane across a remount, as closing and reopening does", async () => {
    const first = render(<RailPanes />);
    await userEvent.click(screen.getByRole("button", { name: /^Tasks/ }));
    first.unmount();

    render(<RailPanes />);
    expect(screen.getByTestId("task-add-input")).toBeInTheDocument();
  });

  it("remembers the app the feed was filtered to", async () => {
    useHubStore.setState({
      agentApps: [
        { agentId: "a1", agentName: "Grok Bot", id: "gmail", label: "Gmail", health: "ok" },
      ] as never,
    });
    const first = render(<RailPanes />);
    await userEvent.click(screen.getByTitle(/Gmail/));
    expect(useRailStore.getState().lastApp).toBe("gmail");
    first.unmount();

    render(<RailPanes />);
    expect(screen.getByTitle(/Gmail/)).toHaveAttribute("data-selected", "true");
  });

});
