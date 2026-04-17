import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

// Mock the Tauri core bridge so we can intercept invoke() calls without a
// real webview. The factory runs before module imports, so we use vi.fn()
// inline and retrieve the spy via vi.mocked() after the module is loaded.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

// Keep the app under test isolated from the real WebSocket / notification /
// theme subsystems — those have their own coverage.
vi.mock("./hooks/useWebSocket", () => ({ useWebSocket: () => {} }));
vi.mock("./hooks/useTheme", () => ({ useTheme: () => {} }));

import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { useHubStore, DEFAULT_EXPANDED_HEIGHT } from "./stores/hubStore";

const invokeMock = vi.mocked(invoke);

describe("App window sizing", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    invokeMock.mockResolvedValue(null);
    useHubStore.setState({
      sessions: [],
      messages: {},
      viewState: "expanded",
      activeSessionId: null,
      unreadSessions: new Set(),
      expandedHeight: DEFAULT_EXPANDED_HEIGHT,
    });
  });

  it("restores expanded height when entering expanded view", async () => {
    render(<App />);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("resize_preserving_width", {
        height: DEFAULT_EXPANDED_HEIGHT,
      });
    });
  });

  it("resizes to measured content height when entering collapsed view", async () => {
    render(<App />);
    invokeMock.mockClear();

    await act(async () => {
      useHubStore.getState().setViewState("collapsed");
    });

    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter(
        ([cmd]) => cmd === "resize_preserving_width"
      );
      expect(calls.length).toBeGreaterThan(0);
      const [, args] = calls[calls.length - 1];
      // Measured heights come from jsdom's layout which reports 0 for most
      // elements, so we only assert the payload shape rather than a value.
      expect(args).toHaveProperty("height");
      expect(typeof (args as { height: number }).height).toBe("number");
    });
  });

  it("restores the persisted expanded height, not a hardcoded default", async () => {
    const customHeight = 720;
    useHubStore.setState({ expandedHeight: customHeight, viewState: "collapsed" });
    render(<App />);
    invokeMock.mockClear();

    await act(async () => {
      useHubStore.getState().setViewState("expanded");
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("resize_preserving_width", {
        height: customHeight,
      });
    });
  });

  it("captures expanded height before collapsing and restores it on expand", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_logical_size") return [500, 888] as unknown;
      return null;
    });
    render(<App />);

    // The WindowBar renders a "Collapse" button while viewState === "expanded".
    const collapseBtn = (await import("@testing-library/react")).screen.getByRole(
      "button",
      { name: /collapse/i }
    );

    await act(async () => {
      collapseBtn.click();
    });

    await waitFor(() => {
      expect(useHubStore.getState().expandedHeight).toBe(888);
      expect(useHubStore.getState().viewState).toBe("collapsed");
    });
  });

  it("updates the tray badge on mount", async () => {
    render(<App />);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_tray_badge", { count: 0 });
    });
  });
});
