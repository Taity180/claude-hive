import { beforeEach, describe, expect, it } from "vitest";
import { useRailStore, RAIL_STORAGE_KEY } from "./railStore";

describe("railStore settings", () => {
  beforeEach(() => {
    localStorage.clear();
    useRailStore.setState(useRailStore.getInitialState(), true);
  });

  it("defaults to click-to-open, always visible, own window", () => {
    const s = useRailStore.getState();
    expect(s.openOn).toBe("click");
    expect(s.hideWhenIdle).toBe(false);
    expect(s.combined).toBe(false);
    expect(s.mutedApps).toEqual([]);
  });

  it("mutes and unmutes an app", () => {
    useRailStore.getState().toggleAppMuted("gmail");
    expect(useRailStore.getState().isAppMuted("gmail")).toBe(true);
    expect(useRailStore.getState().isAppMuted("github")).toBe(false);

    useRailStore.getState().toggleAppMuted("gmail");
    expect(useRailStore.getState().isAppMuted("gmail")).toBe(false);
  });

  it("persists every setting across a reload", () => {
    const s = useRailStore.getState();
    s.setOpenOn("hover");
    s.setHideWhenIdle(true);
    s.setCombined(true);
    s.toggleAppMuted("gmail");

    const saved = JSON.parse(localStorage.getItem(RAIL_STORAGE_KEY) ?? "{}");
    expect(saved.openOn).toBe("hover");
    expect(saved.hideWhenIdle).toBe(true);
    expect(saved.combined).toBe(true);
    expect(saved.mutedApps).toEqual(["gmail"]);
  });

  it("does not persist the open flag", () => {
    useRailStore.getState().setOpen(true);
    const saved = JSON.parse(localStorage.getItem(RAIL_STORAGE_KEY) ?? "{}");
    expect(saved.open).toBeUndefined();
  });

  it("forgets a remembered size for one anchor only", () => {
    // The settings pane needs this rather than mutating `sizes` itself —
    // reaching into store state from a component is how dead wiring starts.
    const s = useRailStore.getState();
    s.setSizeForAnchor("right", [400, 700]);
    s.setSizeForAnchor("bottom", [900, 260]);

    s.forgetSizeForAnchor("right");
    expect(useRailStore.getState().sizes.right).toBeUndefined();
    expect(useRailStore.getState().sizes.bottom).toEqual([900, 260]);
  });

  it("falls back to the orientation default after forgetting", () => {
    const s = useRailStore.getState();
    s.setAnchor("right");
    s.setSizeForAnchor("right", [400, 700]);
    s.forgetSizeForAnchor("right");

    const [w, h] = useRailStore.getState().currentSize();
    expect(h).toBeGreaterThan(w);
  });
});
