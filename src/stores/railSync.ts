import { emit, listen } from "@tauri-apps/api/event";
// Type-only, so there is no runtime import cycle with railStore.
import type { AnchorId, OpenOn, RestingForm } from "./railStore";

export const RAIL_SETTINGS_EVENT = "rail-settings-changed";

/**
 * Is there a Tauri IPC to talk over?
 *
 * Under tests and plain `vite dev` there is not, and cross-window sync is
 * meaningless there — so a failure is expected rather than worth reporting.
 */
function underTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Rail settings that must reach the other window.
 *
 * Every field is optional: a broadcast carries only what changed.
 */
export interface RailSettingsPatch {
  anchor?: AnchorId;
  offset?: number;
  restingForm?: RestingForm;
  followCursor?: boolean;
  openOn?: OpenOn;
  hideWhenIdle?: boolean;
  combined?: boolean;
  pinnedMonitor?: number | null;
  panelOpacity?: number;
  sidebarOpacity?: number;
  mutedApps?: string[];
}

/**
 * Tell the other window a setting changed.
 *
 * Hive and the rail are separate WebView2 instances, so they hold separate
 * Zustand stores. `localStorage` is shared, but each store reads it once at
 * module load and never again — so a change in one window is invisible to the
 * other until it restarts. That is why toggling "Combine with Hive" from the
 * rail appeared to do nothing at all.
 *
 * Tauri events rather than the `storage` event: separate webviews do not
 * reliably deliver `storage` to each other, and an IPC hop is explicit.
 */
export function broadcastRailSettings(patch: RailSettingsPatch): void {
  void emit(RAIL_SETTINGS_EVENT, patch).catch((err) => {
    // The local store is already updated, so this only costs cross-window sync.
    if (underTauri()) console.error("[hive] rail settings broadcast failed:", err);
  });
}

/** Apply the other window's changes. Returns an unlisten function. */
export async function listenForRailSettings(
  apply: (patch: RailSettingsPatch) => void
): Promise<() => void> {
  try {
    return await listen<RailSettingsPatch>(RAIL_SETTINGS_EVENT, (event) => {
      apply(event.payload);
    });
  } catch (err) {
    if (underTauri()) console.error("[hive] rail settings listener failed:", err);
    return () => {};
  }
}
