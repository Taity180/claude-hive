import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
// The rail only polls once Rust says the window is on screen.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isVisible: () => Promise.resolve(true),
    onResized: () => Promise.resolve(() => {}),
  }),
}));
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
    expect(screen.getByTestId("rail-nub")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^All activity/ })).toBeNull();
  });

  it("opens into the sidebar layout, with no Hive group until it moves in", () => {
    // The rail used to carry a row of four tabs and combined mode a sidebar;
    // one layout for both, and Hive's group is the only difference.
    useRailStore.setState({ open: true });
    render(<Rail />);
    expect(screen.getByRole("button", { name: /^All activity/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Sessions/ })).toBeNull();
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
  });

  it("carries Hive's token usage in the combined title bar", () => {
    // The design puts it there, and the rail has to poll for it itself: usage
    // comes from a scan of files on disk, not from the websocket.
    const tokens = { input: 1_000_000, output: 200_000, cacheRead: 0, cacheCreation: 0 };
    useHubStore.setState({
      usage: {
        sessions: [],
        today: tokens,
        todayConnected: tokens,
        days: [],
        todayCostUsd: null,
        scannedAt: null,
      },
    } as never);
    useRailStore.setState({ open: true, combined: true });
    render(<Rail />);
    expect(screen.getByText(/1\.2M/)).toBeInTheDocument();
  });

  it("shows and opens itself when combined mode turns on", async () => {
    render(<Rail />);
    act(() => useRailStore.getState().setCombined(true));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("open_rail"));
    expect(useRailStore.getState().open).toBe(true);
    expect(invokeMock).not.toHaveBeenCalledWith("close_rail");
  });

  it("collapses a hover-opened rail when the pointer leaves", () => {
    // Hover opened it and nothing closed it, so the first brush past the edge
    // left the panel up for good.
    vi.useFakeTimers();
    try {
      useRailStore.setState({ open: true, openOn: "hover" });
      render(<Rail />);
      fireEvent.mouseLeave(screen.getByTestId("rail-root"));
      act(() => vi.advanceTimersByTime(600));
      expect(useRailStore.getState().open).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays open when the pointer comes back before the grace period", () => {
    vi.useFakeTimers();
    try {
      useRailStore.setState({ open: true, openOn: "hover" });
      render(<Rail />);
      const root = screen.getByTestId("rail-root");
      fireEvent.mouseLeave(root);
      act(() => vi.advanceTimersByTime(200));
      fireEvent.mouseEnter(root);
      act(() => vi.advanceTimersByTime(600));
      expect(useRailStore.getState().open).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a click-to-open rail alone, and combined mode too", () => {
    vi.useFakeTimers();
    try {
      useRailStore.setState({ open: true, openOn: "click" });
      render(<Rail />);
      fireEvent.mouseLeave(screen.getByTestId("rail-root"));
      act(() => vi.advanceTimersByTime(600));
      expect(useRailStore.getState().open).toBe(true);

      // Combined mode is the whole window; leaving it must not collapse Hive.
      useRailStore.setState({ open: true, openOn: "hover", combined: true });
      fireEvent.mouseLeave(screen.getByTestId("rail-root"));
      act(() => vi.advanceTimersByTime(600));
      expect(useRailStore.getState().open).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows the cursor in combined mode, and stops while the pointer is on it", async () => {
    // Combined mode is always open, and the follow poll used to be gated on
    // `!open` (plus an explicit `!combined`), so it never followed at all.
    vi.useFakeTimers();
    try {
      useRailStore.setState({ open: true, combined: true, followCursor: true });
      render(<Rail />);
      // onScreen is resolved from a promise; let it land before counting polls.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      invokeMock.mockClear();
      act(() => vi.advanceTimersByTime(600));
      const polled = invokeMock.mock.calls.filter((c) => c[0] === "place_rail");
      expect(polled.length).toBeGreaterThan(0);

      // Pointer on the window: moving it now would move it out from under the
      // hand using it.
      act(() => {
        fireEvent.mouseEnter(screen.getByTestId("rail-root"));
      });
      invokeMock.mockClear();
      act(() => vi.advanceTimersByTime(600));
      expect(invokeMock.mock.calls.filter((c) => c[0] === "place_rail")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not follow while a plain rail panel is open", async () => {
    vi.useFakeTimers();
    try {
      useRailStore.setState({ open: true, combined: false, followCursor: true });
      render(<Rail />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      invokeMock.mockClear();
      act(() => vi.advanceTimersByTime(600));
      expect(invokeMock.mock.calls.filter((c) => c[0] === "place_rail")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
