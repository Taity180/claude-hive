import { invoke } from "@tauri-apps/api/core";
import { nubSize, useRailStore } from "../stores/railStore";

/**
 * Show the rail, telling Rust where to put it first.
 *
 * Both windows share these settings, so either can answer the question. Leaving
 * it to the rail's own placement effect means the window appears at whatever
 * geometry it was last left with — the wrong monitor, or the nub's old rect —
 * and only then jumps into place. The rail cannot avoid that itself: it does not
 * know it is visible until the event that arrives after it already is.
 */
export function openRail(): Promise<void> {
  const { anchor, offset, restingForm, combined, pinnedMonitor, currentSize } =
    useRailStore.getState();

  // Combined mode opens straight into the panel; otherwise the rail arrives
  // resting, as the nub.
  const [width, height] = combined ? currentSize() : nubSize(anchor, restingForm);

  return invoke("open_rail", {
    anchor,
    width,
    height,
    offset,
    monitor: pinnedMonitor,
  });
}
