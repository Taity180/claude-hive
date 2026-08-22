import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTheme } from "./hooks/useTheme";
import { useWebSocket } from "./hooks/useWebSocket";
import { useRailStore } from "./stores/railStore";
import { RailNub } from "./components/RailNub";
import { RailPanel } from "./components/RailPanel";

// Closed, the rail is a strip; open, it is the remembered size for this edge.
const NUB_SIZE: Record<"nub" | "sliver", [number, number]> = {
  nub: [32, 140],
  sliver: [14, 110],
};

export function Rail() {
  useTheme();
  useWebSocket();

  const open = useRailStore((s) => s.open);
  const setOpen = useRailStore((s) => s.setOpen);
  const anchor = useRailStore((s) => s.anchor);
  const offset = useRailStore((s) => s.offset);
  const restingForm = useRailStore((s) => s.restingForm);
  const followCursor = useRailStore((s) => s.followCursor);
  const currentSize = useRailStore((s) => s.currentSize);
  const sizes = useRailStore((s) => s.sizes);

  // The rail window is created hidden at startup, so this component mounts long
  // before it is on screen. Rust tells us when that changes; without it the
  // cursor-follow poll below would run all day against a hidden window.
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const stop = listen<boolean>("rail-visibility", (e) => setOnScreen(e.payload));

    // Ask directly as well as listening. The window can be shown before this
    // component has attached its listener, and missing that one event would
    // leave the rail permanently convinced it is hidden.
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().isVisible())
      .then((visible) => {
        if (visible) setOnScreen(true);
      })
      .catch(() => {
        // Not running under Tauri (tests, plain vite) — stay hidden.
      });

    return () => {
      void stop.then((unlisten) => unlisten());
    };
  }, []);

  // Resize and reposition whenever the shape changes. `sizes` is in the deps
  // so a per-anchor resize takes effect without waiting for another trigger.
  useEffect(() => {
    if (!onScreen) return;
    const [width, height] = open ? currentSize() : NUB_SIZE[restingForm];
    invoke("place_rail", { anchor, width, height, offset }).catch((err) => {
      console.error("[hive] place_rail failed:", err);
    });
  }, [onScreen, open, anchor, offset, restingForm, sizes, currentSize]);

  // Cursor-follow. Polling is the only option — there is no cursor-crossed-
  // monitor event — but 250ms is well below the point where the movement reads
  // as laggy, and it is skipped while the rail is open so the window never
  // yanks out from under a click.
  useEffect(() => {
    if (!onScreen || !followCursor || open) return;
    const [width, height] = NUB_SIZE[restingForm];
    const id = window.setInterval(() => {
      invoke("place_rail", { anchor, width, height, offset }).catch(() => {
        // A transient failure during a display change should not kill the
        // interval; place_rail's own failures are logged by the effect above.
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [onScreen, followCursor, open, anchor, offset, restingForm]);

  return (
    <div
      className="h-screen w-screen overflow-hidden hub-material"
      // Always a solid ground. The window is not a transparent window, so
      // "transparent" here renders as white — which is exactly what a
      // not-yet-painted rail looked like while this feature was being debugged.
      style={{ background: "var(--hub-bg-solid, #141414)" }}
      data-testid="rail-root"
    >
      {open ? <RailPanel /> : <RailNub onOpen={() => setOpen(true)} />}
    </div>
  );
}
