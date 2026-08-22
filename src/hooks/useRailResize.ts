import { useEffect } from "react";
import { useRailStore } from "../stores/railStore";

/**
 * Below this, a reported size is not a panel the user dragged.
 *
 * The nub is 32x140 and its size is set by Rust, not by the user. Recording
 * that as the remembered panel size would shrink the panel to a strip the next
 * time it opened.
 */
const MIN_PANEL_WIDTH = 120;
const MIN_PANEL_HEIGHT = 120;

/**
 * Persist the rail's size when the user drags its edge.
 *
 * `setSizeForAnchor` has existed since phase 2 with nothing calling it, so
 * resizing the rail did nothing — the size was thrown away on the next
 * placement. Sizes are kept per anchor: a right-edge rail wants tall and
 * narrow, a bottom-edge one wide and short.
 */
export function useRailResize() {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const unlisten = await getCurrentWindow().onResized(({ payload }) => {
          // Read live from the store rather than closing over state: the anchor
          // and open flag both change while this listener is attached.
          const { open, anchor, setSizeForAnchor } = useRailStore.getState();
          if (!open) return;

          const { width, height } = payload;
          if (width < MIN_PANEL_WIDTH || height < MIN_PANEL_HEIGHT) return;

          setSizeForAnchor(anchor, [width, height]);
        });
        if (cancelled) {
          unlisten();
        } else {
          stop = unlisten;
        }
      } catch (err) {
        // Not running under Tauri (tests, plain vite): nothing to listen to.
        console.error("[hive] rail resize listener failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
}
