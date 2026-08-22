import { describe, expect, it } from "vitest";
import { badgeCorner, ANCHOR_INSET } from "./railBadge";

describe("badgeCorner", () => {
  it("puts the badge on the inward side when anchored to the right edge", () => {
    // The rail sits against the right edge, so a badge on its right is off
    // screen and clipped by the window. It must face into the desktop.
    for (const anchor of ["right", "tr", "br"] as const) {
      const corner = badgeCorner(anchor);
      expect(corner.left, anchor).toBeDefined();
      expect(corner.right, anchor).toBeUndefined();
    }
  });

  it("puts the badge on the inward side when anchored to the left edge", () => {
    for (const anchor of ["left", "tl", "bl"] as const) {
      const corner = badgeCorner(anchor);
      expect(corner.right, anchor).toBeDefined();
      expect(corner.left, anchor).toBeUndefined();
    }
  });

  it("keeps the badge fully inside the window", () => {
    // It used to be placed at -5, which the OS clipped because the nub is only
    // 32px wide with nothing outside it to draw on.
    const corner = badgeCorner("right");
    expect(corner.top).toBeGreaterThanOrEqual(0);
    expect(corner.left).toBeGreaterThanOrEqual(0);
  });

  it("hugs the top for a bottom-edge rail and vice versa", () => {
    // A horizontal rail is wide and short; the badge goes on the side away
    // from the edge it rests on.
    expect(badgeCorner("bottom").top).toBeGreaterThanOrEqual(0);
    expect(badgeCorner("top").bottom).toBeGreaterThanOrEqual(0);
    expect(badgeCorner("top").top).toBeUndefined();
  });

  it("exposes an inset the window sizing can account for", () => {
    expect(ANCHOR_INSET).toBeGreaterThan(0);
  });
});
