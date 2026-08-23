import type { AnchorId } from "../stores/railStore";

/**
 * Distance the badge is held from the window's own edges.
 *
 * The badge used to sit at -5, hanging outside the window. On a 32px-wide nub
 * there is nothing out there to draw on, so the OS clipped it and the count was
 * unreadable. Everything now stays inside the frame.
 */
export const ANCHOR_INSET = 1;

export interface BadgeCorner {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

const LEFT_ANCHORED: AnchorId[] = ["left", "tl", "bl"];
const BOTTOM_ANCHORED: AnchorId[] = ["bottom", "bl", "br"];

/**
 * Where to pin the unread badge, given the edge the rail rests against.
 *
 * The badge faces *into* the desktop, never towards the screen edge — against
 * the right edge it goes on the left, against the left edge on the right. That
 * is the corner with room to be seen.
 */
export function badgeCorner(anchor: AnchorId): BadgeCorner {
  const corner: BadgeCorner = {};

  // Horizontal edges: the rail is wide and short, so only the vertical side
  // matters for visibility.
  if (anchor === "top") {
    corner.bottom = ANCHOR_INSET;
  } else if (anchor === "bottom") {
    corner.top = ANCHOR_INSET;
  } else if (BOTTOM_ANCHORED.includes(anchor)) {
    corner.top = ANCHOR_INSET;
  } else {
    corner.top = ANCHOR_INSET;
  }

  if (anchor === "top" || anchor === "bottom") {
    // Centred horizontally on its edge: either side is equally visible, so
    // keep it on the trailing side for consistency with the vertical case.
    corner.left = ANCHOR_INSET;
  } else if (LEFT_ANCHORED.includes(anchor)) {
    corner.right = ANCHOR_INSET;
  } else {
    corner.left = ANCHOR_INSET;
  }

  return corner;
}
