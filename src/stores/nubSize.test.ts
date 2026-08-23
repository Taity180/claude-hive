import { describe, expect, it } from "vitest";
import { isHorizontalAnchor, nubSize } from "./railStore";

describe("isHorizontalAnchor", () => {
  it("is true only for the top and bottom edges", () => {
    expect(isHorizontalAnchor("top")).toBe(true);
    expect(isHorizontalAnchor("bottom")).toBe(true);
    for (const a of ["left", "right", "tl", "tr", "bl", "br"] as const) {
      expect(isHorizontalAnchor(a), a).toBe(false);
    }
  });

  it("treats corners as vertical", () => {
    // A corner rail hugs a side, so it reads as a vertical strip; only a rail
    // centred on the top or bottom edge is genuinely wide.
    expect(isHorizontalAnchor("tr")).toBe(false);
    expect(isHorizontalAnchor("bl")).toBe(false);
  });
});

describe("nubSize", () => {
  it("is tall and narrow on a side edge", () => {
    const [w, h] = nubSize("right", "nub");
    expect(h).toBeGreaterThan(w);
  });

  it("is wide and short on a top or bottom edge", () => {
    // The bug: a top-anchored rail stayed 32x140, a vertical strip lying
    // against a horizontal edge.
    for (const anchor of ["top", "bottom"] as const) {
      const [w, h] = nubSize(anchor, "nub");
      expect(w, anchor).toBeGreaterThan(h);
    }
  });

  it("keeps the sliver thinner than the nub on both orientations", () => {
    expect(nubSize("right", "sliver")[0]).toBeLessThan(nubSize("right", "nub")[0]);
    expect(nubSize("top", "sliver")[1]).toBeLessThan(nubSize("top", "nub")[1]);
  });

  it("swaps the same pair of numbers rather than inventing new ones", () => {
    const side = nubSize("right", "nub");
    const top = nubSize("top", "nub");
    expect(top).toEqual([side[1], side[0]]);
  });
});
