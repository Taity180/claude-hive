import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { openRail } from "./openRail";
import { useRailStore } from "../stores/railStore";

describe("openRail", () => {
  beforeEach(() => {
    localStorage.clear();
    invoke.mockReset().mockResolvedValue(undefined);
    useRailStore.setState(useRailStore.getInitialState(), true);
  });

  it("hands Rust the geometry, so the window is placed before it is shown", async () => {
    // Showing first and placing afterwards is a visible flash at the old rect.
    useRailStore.setState({ anchor: "bottom", offset: 20, restingForm: "nub" });
    await openRail();

    expect(invoke).toHaveBeenCalledWith("open_rail", {
      anchor: "bottom",
      // A bottom-anchored nub lies down: the pair swaps.
      width: 140,
      height: 32,
      offset: 20,
      monitor: null,
    });
  });

  it("opens at the panel size in combined mode, which has no resting state", async () => {
    useRailStore.setState({ combined: true, anchor: "right" });
    await openRail();

    const args = invoke.mock.calls[0][1] as { width: number; height: number };
    expect(args.width).toBeGreaterThan(400);
    expect(args.height).toBeGreaterThan(400);
  });

  it("passes the pinned monitor, so it does not appear on the wrong screen first", async () => {
    useRailStore.setState({ pinnedMonitor: 2 });
    await openRail();
    expect(invoke.mock.calls[0][1]).toMatchObject({ monitor: 2 });
  });

  it("uses the remembered size for the anchor it will open on", async () => {
    useRailStore.setState({ combined: true, anchor: "left" });
    useRailStore.getState().setSizeForAnchor("left", [640, 720]);
    await openRail();
    expect(invoke.mock.calls[0][1]).toMatchObject({ width: 640, height: 720 });
  });
});
