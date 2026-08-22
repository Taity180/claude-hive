import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { payload: { width: number; height: number } }) => void;

const { onResized, isVisible } = vi.hoisted(() => ({
  onResized: vi.fn(),
  isVisible: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onResized, isVisible }),
}));

import { useRailResize } from "./useRailResize";
import { useRailStore } from "../stores/railStore";

let fire: Handler = () => {};

describe("useRailResize", () => {
  beforeEach(() => {
    localStorage.clear();
    useRailStore.setState(useRailStore.getInitialState(), true);
    onResized.mockReset().mockImplementation((handler: Handler) => {
      fire = handler;
      return Promise.resolve(() => {});
    });
    isVisible.mockReset().mockResolvedValue(true);
  });

  it("persists a drag against the current anchor", async () => {
    useRailStore.setState({ anchor: "right", open: true });
    renderHook(() => useRailResize());
    await waitFor(() => expect(onResized).toHaveBeenCalled());

    fire({ payload: { width: 420, height: 700 } });
    await waitFor(() =>
      expect(useRailStore.getState().sizes.right).toEqual([420, 700])
    );
  });

  it("keeps each anchor's size separate", async () => {
    useRailStore.setState({ anchor: "right", open: true });
    renderHook(() => useRailResize());
    await waitFor(() => expect(onResized).toHaveBeenCalled());
    fire({ payload: { width: 420, height: 700 } });
    await waitFor(() => expect(useRailStore.getState().sizes.right).toBeDefined());

    useRailStore.setState({ anchor: "bottom" });
    fire({ payload: { width: 900, height: 260 } });
    await waitFor(() =>
      expect(useRailStore.getState().sizes.bottom).toEqual([900, 260])
    );
    // A right-edge rail wants tall and narrow, a bottom one wide and short, so
    // one shared size would be wrong for half the anchors.
    expect(useRailStore.getState().sizes.right).toEqual([420, 700]);
  });

  it("ignores resizes while collapsed, which are the nub's own size", async () => {
    // The nub is 32x140 and set by Rust; recording that as the user's remembered
    // panel size would shrink the panel to a strip on next open.
    useRailStore.setState({ anchor: "right", open: false });
    renderHook(() => useRailResize());
    await waitFor(() => expect(onResized).toHaveBeenCalled());

    fire({ payload: { width: 32, height: 140 } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(useRailStore.getState().sizes.right).toBeUndefined();
  });

  it("ignores an implausibly small size", async () => {
    useRailStore.setState({ anchor: "right", open: true });
    renderHook(() => useRailResize());
    await waitFor(() => expect(onResized).toHaveBeenCalled());

    fire({ payload: { width: 20, height: 30 } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(useRailStore.getState().sizes.right).toBeUndefined();
  });
});
