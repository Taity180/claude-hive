import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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

  // Resize and reposition whenever the shape changes. `sizes` is in the deps
  // so a per-anchor resize takes effect without waiting for another trigger.
  useEffect(() => {
    const [width, height] = open ? currentSize() : NUB_SIZE[restingForm];
    invoke("place_rail", { anchor, width, height, offset }).catch((err) => {
      console.error("[hive] place_rail failed:", err);
    });
  }, [open, anchor, offset, restingForm, sizes, currentSize]);

  // Cursor-follow. Polling is the only option — there is no cursor-crossed-
  // monitor event — but 250ms is well below the point where the movement reads
  // as laggy, and it is skipped while the rail is open so the window never
  // yanks out from under a click.
  useEffect(() => {
    if (!followCursor || open) return;
    const [width, height] = NUB_SIZE[restingForm];
    const id = window.setInterval(() => {
      invoke("place_rail", { anchor, width, height, offset }).catch(() => {
        // A transient failure during a display change should not kill the
        // interval; place_rail's own failures are logged by the effect above.
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [followCursor, open, anchor, offset, restingForm]);

  return (
    <div
      className="h-screen w-screen overflow-hidden hub-material"
      style={{ background: open ? "var(--hub-bg)" : "transparent" }}
      data-testid="rail-root"
    >
      {open ? <RailPanel /> : <RailNub onOpen={() => setOpen(true)} />}
    </div>
  );
}
