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

/**
 * Advance fake timers in steps, flushing microtasks between them.
 *
 * The cursor poll acts inside a promise continuation, so the close timer is only
 * *scheduled* once that resolves. One long `advanceTimersByTime` runs every
 * interval tick before any of those continuations, and the close never lands.
 */
async function tick(ms: number, step = 100) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await act(async () => {
      vi.advanceTimersByTime(step);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

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
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("open_rail", expect.any(Object))
    );
    expect(useRailStore.getState().open).toBe(true);
    expect(invokeMock).not.toHaveBeenCalledWith("close_rail");
  });

  it("opens and closes on hover from where the cursor actually is", async () => {
    // Not from DOM events: a 32px strip at the screen edge often never gets a
    // mouseenter, and an open panel often never gets the matching mouseleave.
    vi.useFakeTimers();
    try {
      let over = false;
      invokeMock.mockImplementation((cmd: string) =>
        cmd === "cursor_over_rail" ? Promise.resolve(over) : Promise.resolve(null)
      );
      useRailStore.setState({ openOn: "hover", followCursor: false });
      render(<Rail />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      over = true;
      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });
      expect(useRailStore.getState().open).toBe(true);

      over = false;
      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });
      // Still open: the grace period has not elapsed.
      expect(useRailStore.getState().open).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
      });
      expect(useRailStore.getState().open).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a hover-opened rail open if the cursor comes back in time", async () => {
    vi.useFakeTimers();
    try {
      let over = true;
      invokeMock.mockImplementation((cmd: string) =>
        cmd === "cursor_over_rail" ? Promise.resolve(over) : Promise.resolve(null)
      );
      useRailStore.setState({ open: true, openOn: "hover", followCursor: false });
      render(<Rail />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      over = false;
      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });
      over = true;
      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
      });
      expect(useRailStore.getState().open).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a click-to-open rail alone", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockImplementation((cmd: string) =>
        cmd === "cursor_over_rail" ? Promise.resolve(false) : Promise.resolve(null)
      );
      useRailStore.setState({ open: true, openOn: "click", followCursor: false });
      render(<Rail />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await tick(900);
      expect(useRailStore.getState().open).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes on hover in combined mode as well", async () => {
    // Combined mode was exempt, on the grounds that collapsing the whole of Hive
    // is a lot to happen from a cursor moving. It is the same Open-on setting
    // either way, so the exemption was the surprise, not the closing.
    vi.useFakeTimers();
    try {
      invokeMock.mockImplementation((cmd: string) =>
        cmd === "cursor_over_rail" ? Promise.resolve(false) : Promise.resolve(null)
      );
      useRailStore.setState({ open: true, openOn: "hover", combined: true });
      render(<Rail />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await tick(900);
      expect(useRailStore.getState().open).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hovers the same way whether it follows the cursor or is pinned", async () => {
    // The bug: hover worked only with cursor-follow on, because the placement
    // poll was accidentally generating the mouse events it depended on.
    for (const pinnedMonitor of [null, 1]) {
      vi.useFakeTimers();
      try {
        invokeMock.mockImplementation((cmd: string) =>
          cmd === "cursor_over_rail" ? Promise.resolve(true) : Promise.resolve(null)
        );
        useRailStore.setState(useRailStore.getInitialState(), true);
        useRailStore.setState({ openOn: "hover", followCursor: false, pinnedMonitor });
        const view = render(<Rail />);
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        await act(async () => {
          vi.advanceTimersByTime(250);
          await Promise.resolve();
        });
        expect(useRailStore.getState().open, `pinnedMonitor=${pinnedMonitor}`).toBe(true);
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  });

  it("follows the cursor whether combined or not, and stops while it is on the rail", async () => {
    // One rule: follow unless the pointer is on it. An open panel used to be
    // excluded and then followed anyway, through the placement loop.
    for (const combined of [true, false]) {
      vi.useFakeTimers();
      try {
        let over = false;
        invokeMock.mockImplementation((cmd: string) =>
          cmd === "cursor_over_rail" ? Promise.resolve(over) : Promise.resolve(null)
        );
        useRailStore.setState(useRailStore.getInitialState(), true);
        useRailStore.setState({ open: true, combined, followCursor: true, openOn: "click" });
        const view = render(<Rail />);
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        invokeMock.mockClear();
        await act(async () => {
          vi.advanceTimersByTime(600);
          await Promise.resolve();
        });
        expect(
          invokeMock.mock.calls.filter((c) => c[0] === "place_rail").length,
          `combined=${combined} should follow`
        ).toBeGreaterThan(0);

        // Pointer on the window: moving it now would move it under the hand.
        over = true;
        await act(async () => {
          vi.advanceTimersByTime(250);
          await Promise.resolve();
        });
        invokeMock.mockClear();
        await act(async () => {
          vi.advanceTimersByTime(600);
          await Promise.resolve();
        });
        expect(
          invokeMock.mock.calls.filter((c) => c[0] === "place_rail"),
          `combined=${combined} must not move under the pointer`
        ).toHaveLength(0);

        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  });

  it("does not re-place itself when a resize is recorded", async () => {
    // Every placement makes the OS report a resize, which useRailResize stores.
    // Keying placement on those sizes made it re-trigger itself, so the rail
    // hopped monitors as a side effect of its own resizing.
    useRailStore.setState({ open: true, followCursor: false });
    render(<Rail />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    invokeMock.mockClear();
    act(() => {
      useRailStore.getState().setSizeForAnchor("right", [600, 700]);
    });
    expect(invokeMock.mock.calls.filter((c) => c[0] === "place_rail")).toHaveLength(0);
  });

  it("stops following the cursor while pinned to a screen", async () => {
    // A pin is the user saying which screen; polling the cursor would only
    // re-place the rail where it already is.
    vi.useFakeTimers();
    try {
      useRailStore.setState({ open: true, followCursor: true, pinnedMonitor: 1 });
      render(<Rail />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const placed = invokeMock.mock.calls.filter((c) => c[0] === "place_rail");
      expect(placed.length, "placed once for the pin").toBeGreaterThan(0);
      expect(placed[placed.length - 1][1]).toMatchObject({ monitor: 1 });

      invokeMock.mockClear();
      act(() => vi.advanceTimersByTime(600));
      expect(invokeMock.mock.calls.filter((c) => c[0] === "place_rail")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("paints each surface once, so the two opacities stay independent", () => {
    // Painting the root as well would stack the panel's alpha under the
    // sidebar's, making one setting depend on the other.
    useRailStore.setState({ open: true, panelOpacity: 0.5, sidebarOpacity: 0.9 });
    render(<Rail />);

    const root = screen.getByTestId("rail-root");
    expect(root.style.background).toBe("transparent");

    const panel = screen.getByTestId("rail-panel");
    expect(panel.style.background).toContain("50%");

    const sidebar = screen.getByRole("button", { name: /^All activity/ })
      .parentElement!.parentElement as HTMLElement;
    expect(sidebar.style.background).toContain("90%");
  });

  it("waits for the panel to be painted before resizing the window", async () => {
    // The flash was the frosted backdrop arriving before the content. Painting
    // first and then resizing once leaves nothing to flash — and nothing to
    // travel, which is what animating the window itself caused.
    const frames: FrameRequestCallback[] = [];
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      });

    try {
      invokeMock.mockImplementation((cmd: string) =>
        cmd === "cursor_over_rail" ? Promise.resolve(false) : Promise.resolve(null)
      );
      useRailStore.setState({ open: false, openOn: "click", followCursor: false });
      render(<Rail />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      invokeMock.mockClear();
      await act(async () => {
        useRailStore.getState().setOpen(true);
        await Promise.resolve();
      });

      // Nothing placed yet: the panel has been rendered, not yet painted.
      expect(invokeMock.mock.calls.filter((c) => c[0] === "place_rail")).toHaveLength(0);

      // Two frames later it places, once, with no interpolation.
      await act(async () => {
        frames.forEach((frame) => frame(0));
        await Promise.resolve();
      });
      await act(async () => {
        frames.forEach((frame) => frame(0));
        await Promise.resolve();
      });

      const placed = invokeMock.mock.calls.filter((c) => c[0] === "place_rail");
      expect(placed.length).toBeGreaterThan(0);
      expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain("animate_rail");
    } finally {
      raf.mockRestore();
    }
  });

  it("lays the panel out at its final size, so the resize reveals it", async () => {
    // Otherwise the content reflows on every frame of the animation.
    useRailStore.setState({ open: true, anchor: "right" });
    useRailStore.getState().setSizeForAnchor("right", [480, 700]);
    render(<Rail />);

    const panel = screen.getByTestId("rail-panel");
    expect(panel.style.width).toBe("480px");
    expect(panel.style.height).toBe("700px");
  });

  it("keeps the nub on screen while the panel rasterises behind it", async () => {
    // The two frames before the resize used to show a slice of the panel
    // clipped into the nub's 32px window, which is what still read as a flash.
    const frames: FrameRequestCallback[] = [];
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      });

    try {
      invokeMock.mockImplementation((cmd: string) =>
        cmd === "cursor_over_rail" ? Promise.resolve(false) : Promise.resolve(null)
      );
      useRailStore.setState({ open: false, openOn: "click", followCursor: false });
      render(<Rail />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        useRailStore.getState().setOpen(true);
        await Promise.resolve();
      });

      // Painted but not shown, with the nub still covering it.
      expect(screen.getByTestId("rail-panel").style.opacity).toBe("0");
      expect(screen.getByTestId("rail-nub")).toBeInTheDocument();

      await act(async () => {
        frames.forEach((frame) => frame(0));
        await Promise.resolve();
      });
      await act(async () => {
        frames.forEach((frame) => frame(0));
        await Promise.resolve();
      });

      expect(screen.getByTestId("rail-panel").style.opacity).toBe("1");
      expect(screen.queryByTestId("rail-nub")).toBeNull();
    } finally {
      raf.mockRestore();
    }
  });
});
