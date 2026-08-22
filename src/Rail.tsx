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
