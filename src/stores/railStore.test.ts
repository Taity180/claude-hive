import { beforeEach, describe, expect, it } from "vitest";
import { useRailStore, RAIL_STORAGE_KEY } from "./railStore";

describe("railStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useRailStore.setState(useRailStore.getInitialState(), true);
  });

  it("defaults to a nub on the right that follows the cursor", () => {
    const s = useRailStore.getState();
    expect(s.anchor).toBe("right");
    expect(s.restingForm).toBe("nub");
    expect(s.followCursor).toBe(true);
    expect(s.open).toBe(false);
  });

  it("keeps a separate size per anchor", () => {
    useRailStore.getState().setSizeForAnchor("right", [372, 620]);
    useRailStore.getState().setSizeForAnchor("bottom", [900, 260]);

    useRailStore.getState().setAnchor("right");
    expect(useRailStore.getState().currentSize()).toEqual([372, 620]);

    useRailStore.getState().setAnchor("bottom");
    expect(useRailStore.getState().currentSize()).toEqual([900, 260]);
  });

  it("gives an unsized anchor a sensible default for its orientation", () => {
    useRailStore.getState().setAnchor("bottom");
    const [w, h] = useRailStore.getState().currentSize();
    expect(w).toBeGreaterThan(h);

    useRailStore.getState().setAnchor("left");
    const [w2, h2] = useRailStore.getState().currentSize();
    expect(h2).toBeGreaterThan(w2);
  });

  it("persists settings across a reload", () => {
    useRailStore.getState().setAnchor("bl");
    useRailStore.getState().setOffset(16);
    useRailStore.getState().setSizeForAnchor("bl", [400, 300]);

    const saved = JSON.parse(localStorage.getItem(RAIL_STORAGE_KEY) ?? "{}");
    expect(saved.anchor).toBe("bl");
    expect(saved.offset).toBe(16);
    expect(saved.sizes.bl).toEqual([400, 300]);
  });

  it("survives corrupt stored settings", () => {
    localStorage.setItem(RAIL_STORAGE_KEY, "{not json");
    expect(() => useRailStore.getState().setAnchor("top")).not.toThrow();
  });

  it("does not persist the open flag — a restart should rest, not reopen", () => {
    useRailStore.getState().setOpen(true);
    const saved = JSON.parse(localStorage.getItem(RAIL_STORAGE_KEY) ?? "{}");
    expect(saved.open).toBeUndefined();
  });

  it("remembers combined mode's size apart from the plain rail's", () => {
    // The same edge wants very different shapes in the two modes: a 372px
    // strip for the rail's own panes, most of the screen once Hive is in it.
    useRailStore.getState().setSizeForAnchor("right", [372, 620]);
    useRailStore.getState().setCombined(true);
    expect(useRailStore.getState().currentSize()).not.toEqual([372, 620]);

    useRailStore.getState().setSizeForAnchor("right", [900, 800]);
    expect(useRailStore.getState().currentSize()).toEqual([900, 800]);

    useRailStore.getState().setCombined(false);
    expect(useRailStore.getState().currentSize()).toEqual([372, 620]);
  });

  it("forgetting an edge's size clears it for both modes", () => {
    // Deliberately not the default size, so falling back to the default is
    // distinguishable from the stored size surviving.
    useRailStore.getState().setSizeForAnchor("right", [300, 500]);
    useRailStore.getState().setCombined(true);
    useRailStore.getState().setSizeForAnchor("right", [900, 800]);

    useRailStore.getState().forgetSizeForAnchor("right");
    expect(useRailStore.getState().currentSize()).not.toEqual([900, 800]);
    useRailStore.getState().setCombined(false);
    expect(useRailStore.getState().currentSize()).not.toEqual([300, 500]);
  });
});
