import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTheme } from "./hooks/useTheme";
import { useWebSocket } from "./hooks/useWebSocket";
import { isHorizontalAnchor, nubSize, useRailStore } from "./stores/railStore";
import { RailNub } from "./components/RailNub";
import { RailPanel } from "./components/RailPanel";
import { AgentsPane } from "./components/AgentsPane";
import { TasksPane } from "./components/TasksPane";
import { RailChrome } from "./components/RailChrome";
import { RailSettingsPane } from "./components/RailSettingsPane";
import { CombinedPanes } from "./components/CombinedPanes";
import { DetachHiveButton } from "./components/DetachHiveButton";
import { PlanUsageChip } from "./components/PlanUsage";
import { GlobalUsage } from "./components/UsageMeter";
import { useAgentData } from "./hooks/useAgentData";
import { useUsage } from "./hooks/useUsage";
import { useRailResize } from "./hooks/useRailResize";
import { useRailSettingsSync } from "./hooks/useRailSettingsSync";

export function Rail() {
  useTheme();
  useWebSocket();
  useAgentData();
  // Combined mode shows Hive's usage chips in the title bar, and those numbers
  // come from a poll rather than the socket — so the rail has to run it too.
  useUsage();
  useRailResize();
  useRailSettingsSync();

  const open = useRailStore((s) => s.open);
  const setOpen = useRailStore((s) => s.setOpen);
  const anchor = useRailStore((s) => s.anchor);
  const offset = useRailStore((s) => s.offset);
  const restingForm = useRailStore((s) => s.restingForm);
  const followCursor = useRailStore((s) => s.followCursor);
  const currentSize = useRailStore((s) => s.currentSize);
  const sizes = useRailStore((s) => s.sizes);
  const combined = useRailStore((s) => s.combined);

  // The rail window is created hidden at startup, so this component mounts long
  // before it is on screen. Rust tells us when that changes; without it the
  // cursor-follow poll below would run all day against a hidden window.
  const [pane, setPane] = useState<"feed" | "tasks" | "agents" | "settings">("feed");
  // Which edge the panel grows from, so the slide-in runs the right way.
  const anchorSide = isHorizontalAnchor(anchor)
    ? anchor === "top"
      ? "top"
      : "bottom"
    : anchor === "left" || anchor === "tl" || anchor === "bl"
      ? "left"
      : "right";
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
    const [width, height] = open ? currentSize() : nubSize(anchor, restingForm);
    invoke("place_rail", { anchor, width, height, offset }).catch((err) => {
      console.error("[hive] place_rail failed:", err);
    });
  }, [onScreen, open, combined, anchor, offset, restingForm, sizes, currentSize]);

  // Combined mode moves Hive *into the rail*, so the rail becomes the only
  // window: it has to be showing and open, not stepping aside.
  useEffect(() => {
    if (!combined) return;
    invoke("open_rail").catch((err) => {
      console.error("[hive] open_rail failed:", err);
    });
    setOpen(true);
  }, [combined, setOpen]);

  // Cursor-follow. Polling is the only option — there is no cursor-crossed-
  // monitor event — but 250ms is well below the point where the movement reads
  // as laggy, and it is skipped while the rail is open so the window never
  // yanks out from under a click.
  useEffect(() => {
    if (!onScreen || combined || !followCursor || open) return;
    const [width, height] = nubSize(anchor, restingForm);
    const id = window.setInterval(() => {
      invoke("place_rail", { anchor, width, height, offset }).catch(() => {
        // A transient failure during a display change should not kill the
        // interval; place_rail's own failures are logged by the effect above.
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [onScreen, combined, followCursor, open, anchor, offset, restingForm]);

  // The rail is a decorationless window, so the title bar has to move it. Same
  // handler Hive's own bar uses; buttons are excluded or dragging would eat the
  // clicks on the chips and the detach button.
  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    invoke("start_dragging").catch((err) => {
      console.error("[hive] start_dragging failed:", err);
    });
  };

  return (
    <div
      className="h-screen w-screen overflow-hidden hub-material"
      // Always a solid ground. The window is not a transparent window, so
      // "transparent" here renders as white — which is exactly what a
      // not-yet-painted rail looked like while this feature was being debugged.
      style={{ background: "var(--hub-bg-solid, #141414)" }}
      data-testid="rail-root"
    >
      {open && combined ? (
        // Hive lives here now, so the sidebar layout replaces the tab strip —
        // five panes is more than a row of tabs can carry.
        <div className="flex flex-col h-full rail-slide-in" data-anchor-side={anchorSide}>
          <div
            data-tauri-drag-region
            onMouseDown={startDrag}
            className="flex items-center gap-2 px-2.5 py-1.5 shrink-0 select-none cursor-grab active:cursor-grabbing"
            style={{ borderBottom: "1px solid var(--hub-hair)" }}
          >
            <span className="text-[12px] font-semibold" style={{ color: "var(--hub-text)" }}>
              Hive
            </span>
            <span className="flex-1" />
            <PlanUsageChip />
            <GlobalUsage />
            <DetachHiveButton />
            <RailChrome onCollapse={() => setOpen(false)} />
          </div>
          <CombinedPanes />
        </div>
      ) : open ? (
        <div className="flex flex-col h-full rail-slide-in" data-anchor-side={anchorSide}>
          <div
            className="flex items-center gap-1 px-2 pt-2 shrink-0"
            role="group"
            aria-label="Rail pane"
          >
            {(["feed", "tasks", "agents", "settings"] as const).map((id) => (
              <button
                key={id}
                type="button"
                data-testid={`pane-${id}`}
                aria-pressed={pane === id}
                onClick={() => setPane(id)}
                className="text-[11px] rounded-md px-2 py-0.5"
                style={{
                  border: 0,
                  cursor: "pointer",
                  fontWeight: pane === id ? 600 : 500,
                  background: pane === id ? "var(--hub-surface)" : "transparent",
                  color: pane === id ? "var(--hub-text)" : "var(--hub-text-muted)",
                }}
              >
                {id === "feed" ? "Activity" : id === "tasks" ? "Tasks" : id === "agents" ? "Agents" : "Settings"}
              </button>
            ))}
            <span className="flex-1" />
            <RailChrome onCollapse={() => setOpen(false)} />
          </div>
          {pane === "feed" ? (
            <RailPanel />
          ) : pane === "tasks" ? (
            <TasksPane />
          ) : pane === "agents" ? (
            <AgentsPane />
          ) : (
            <RailSettingsPane />
          )}
        </div>
      ) : (
        <RailNub onOpen={() => setOpen(true)} />
      )}
    </div>
  );
}
