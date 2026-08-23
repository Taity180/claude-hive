import { invoke } from "@tauri-apps/api/core";

export interface PlacementArgs extends Record<string, unknown> {
  anchor: string;
  width: number;
  height: number;
  offset: number;
  monitor: number | null;
}

/**
 * How long after a placement a resize is assumed to be ours, not the user's.
 *
 * Longer than the animation in `rail/window.rs`, because every frame of it
 * reports a resize.
 */
const SUPPRESS_MS = 400;

let suppressUntil = 0;

/**
 * Place the rail, and remember that we asked.
 *
 * Placement and the suppression window live together deliberately. The OS
 * reports a resize for every placement, and the animation reports nine of them
 * — all of which `useRailResize` was recording as the size the user had dragged.
 * Each open therefore started from a slightly smaller remembered size, recorded
 * intermediate frames of *that*, and ratcheted the panel down towards nothing.
 */
export function placeRail(args: PlacementArgs, animate = false): Promise<void> {
  markPlacement();
  return invoke(animate ? "animate_rail" : "place_rail", args);
}

/** Note a placement made by some other route, so its resize is not recorded. */
export function markPlacement(): void {
  suppressUntil = Date.now() + SUPPRESS_MS;
}

/**
 * How long after a resize the user is assumed to still be dragging.
 *
 * A drag arrives as a stream of resize events; this only has to outlast the gap
 * between two of them.
 */
const DRAG_MS = 700;

let draggingUntil = 0;

/** A resize that was not ours: the user has hold of an edge. */
export function markUserResize(): void {
  draggingUntil = Date.now() + DRAG_MS;
}

/**
 * Is the user resizing the rail right now?
 *
 * Hover-close has to stand down while they are. Dragging an edge outward takes
 * the cursor outside the window — that is what dragging outward means — so the
 * rail would collapse mid-drag and there was no way to make the panel bigger.
 */
export function isUserResizing(): boolean {
  return Date.now() < draggingUntil;
}

/** Did we cause the resize that just arrived? */
export function isOurResize(): boolean {
  return Date.now() < suppressUntil;
}

/** Test seam: forget any suppression window. */
export function resetPlacementGuard(): void {
  suppressUntil = 0;
  draggingUntil = 0;
}
