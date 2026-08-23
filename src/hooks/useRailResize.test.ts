import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

type ResizeHandler = (event: { payload: { width: number; height: number } }) => void;

const { onResized, handlers } = vi.hoisted(() => {
  const handlers: ResizeHandler[] = [];
  return {
    handlers,
    onResized: vi.fn((handler: ResizeHandler) => {
      handlers.push(handler);
      return Promise.resolve(() => {});
    }),
  };
});
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onResized }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));

import { useRailResize } from "./useRailResize";
import { useRailStore } from "../stores/railStore";
import { placeRail, resetPlacementGuard } from "../rail/placement";

const resize = (width: number, height: number) => {
  for (const handler of handlers) handler({ payload: { width, height } });
};

describe("useRailResize", () => {
  beforeEach(() => {
    handlers.length = 0;
    localStorage.clear();
    resetPlacementGuard();
    useRailStore.setState(useRailStore.getInitialState(), true);
    useRailStore.setState({ open: true, anchor: "right" });
  });

  it("records a size the user dragged", async () => {
    renderHook(() => useRailResize());
    await vi.waitFor(() => expect(handlers.length).toBe(1));

    resize(600, 800);
    expect(useRailStore.getState().sizes.right).toEqual([600, 800]);
  });

  it("ignores the resize its own placement caused", async () => {
    // The open animation reports one resize per frame. Recording those as the
    // user's dragged size ratcheted the panel down a little on every open.
    renderHook(() => useRailResize());
    await vi.waitFor(() => expect(handlers.length).toBe(1));

    void placeRail(
      { anchor: "right", width: 520, height: 660, offset: 14, monitor: null },
      true
    );
    resize(178, 300);
    resize(340, 480);
    resize(520, 660);

    expect(useRailStore.getState().sizes.right).toBeUndefined();
  });

  it("records again once the placement window has passed", async () => {
    renderHook(() => useRailResize());
    await vi.waitFor(() => expect(handlers.length).toBe(1));

    void placeRail(
      { anchor: "right", width: 520, height: 660, offset: 14, monitor: null },
      true
    );
    resetPlacementGuard();

    resize(640, 720);
    expect(useRailStore.getState().sizes.right).toEqual([640, 720]);
  });

  it("ignores a resize while the rail is resting", async () => {
    useRailStore.setState({ open: false });
    renderHook(() => useRailResize());
    await vi.waitFor(() => expect(handlers.length).toBe(1));

    resize(600, 800);
    expect(useRailStore.getState().sizes.right).toBeUndefined();
  });
});
