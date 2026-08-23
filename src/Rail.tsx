import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTheme } from "./hooks/useTheme";
import { useWebSocket } from "./hooks/useWebSocket";
import { isHorizontalAnchor, nubSize, useRailStore, withOpacity } from "./stores/railStore";
import { RailNub } from "./components/RailNub";
import { RailChrome } from "./components/RailChrome";
import { RailPanes } from "./components/RailPanes";
import { DetachHiveButton } from "./components/DetachHiveButton";
import { PlanUsageChip } from "./components/PlanUsage";
import { GlobalUsage } from "./components/UsageMeter";
import { useAgentData } from "./hooks/useAgentData";
import { useUsage } from "./hooks/useUsage";
import { useRailResize } from "./hooks/useRailResize";
import { useRailSettingsSync } from "./hooks/useRailSettingsSync";

/**
 * Grace period before a hover-opened rail collapses again.
 *
 * Long enough to cross a gap between the panel and a control, short enough that
 * the rail does not feel stuck open.
 */
const HOVER_CLOSE_MS = 500;

/**
 * How often the cursor is checked against the rail's rect.
 *
 * Fast enough that opening on hover does not feel delayed, and the same cost as
 * the placement poll it sits beside.
 */
const CURSOR_POLL_MS = 200;

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
  const openOn = useRailStore((s) => s.openOn);
  const pinnedMonitor = useRailStore((s) => s.pinnedMonitor);
  const panelOpacity = useRailStore((s) => s.panelOpacity);
  const currentSize = useRailStore((s) => s.currentSize);
  const sizes = useRailStore((s) => s.sizes);
  const combined = useRailStore((s) => s.combined);

  // The rail window is created hidden at startup, so this component mounts long
  // before it is on screen. Rust tells us when that changes; without it the
  // cursor-follow poll below would run all day against a hidden window.
  // Which edge the panel grows from, so the slide-in runs the right way.
  const anchorSide = isHorizontalAnchor(anchor)
    ? anchor === "top"
      ? "top"
      : "bottom"
    : anchor === "left" || anchor === "tl" || anchor === "bl"
      ? "left"
      : "right";
  const [onScreen, setOnScreen] = useState(false);
  // Whether the pointer is over the rail. Combined mode follows the cursor only
  // while it is not, so the window never moves under the hand using it.
  const [pointerInside, setPointerInside] = useState(false);
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

  // Resize and reposition whenever the shape changes.
  //
  // Deliberately not keyed on `sizes`. Every placement makes the OS emit a
  // resize, which `useRailResize` records, which changes `sizes` — so having it
  // here made placement re-trigger itself, and the rail hopped monitors as a
  // side effect of its own resizing. A size the user dragged is already on
  // screen; the only case that needs a fresh placement is forgetting a size,
  // which the settings row does itself.
  useEffect(() => {
    if (!onScreen) return;
    const [width, height] = open ? currentSize() : nubSize(anchor, restingForm);
    invoke("place_rail", { anchor, width, height, offset, monitor: pinnedMonitor }).catch(
      (err) => {
        console.error("[hive] place_rail failed:", err);
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScreen, open, combined, anchor, offset, restingForm, pinnedMonitor]);

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
  // as laggy.
  //
  // One rule: the rail follows unless the pointer is on it. That is the whole
  // of "never move out from under the hand using it", and crossing to another
  // monitor satisfies it by definition.
  //
  // An open panel used to be excluded, and then followed anyway through the
  // placement loop described above — behaviour worth having, arrived at by
  // accident. This is that behaviour, on purpose.
  //
  // A pin makes the question moot: the rail stays on the screen the user chose,
  // so polling the cursor would only re-place it where it already is.
  const canFollow = !pointerInside && pinnedMonitor === null;
  useEffect(() => {
    if (!onScreen || !followCursor || !canFollow) return;
    const [width, height] = open ? currentSize() : nubSize(anchor, restingForm);
    const id = window.setInterval(() => {
      invoke("place_rail", { anchor, width, height, offset, monitor: null }).catch(() => {
        // A transient failure during a display change should not kill the
        // interval; place_rail's own failures are logged by the effect above.
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [
    onScreen,
    followCursor,
    canFollow,
    open,
    anchor,
    offset,
    restingForm,
    sizes,
    currentSize,
  ]);

  // Hover, decided by where the cursor actually is rather than by DOM events.
  //
  // A 32px strip at the screen edge often never receives a `mouseenter`, and an
  // open panel often never receives the matching `mouseleave`. With
  // cursor-follow on it appeared to work, by accident: repositioning the window
  // four times a second made Windows re-run hit-testing and synthesise the
  // events. Pinned to a monitor there is no poll, so hovering did nothing — and
  // in the other direction the panel would not close again.
  //
  // Asking Rust whether the cursor is over the window is the same question with
  // no accident in it, and it behaves the same however the rail is placed.
  const hoverDrives = openOn === "hover" && !combined;
  const closeTimer = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!onScreen) return;
    // Only ever needed for hover, or to know not to move the window out from
    // under the hand that is using it.
    if (!hoverDrives && !followCursor) return;

    let cancelled = false;
    const id = window.setInterval(() => {
      void invoke<boolean>("cursor_over_rail")
        .then((over) => {
          if (cancelled) return;
          setPointerInside(over);
          if (!hoverDrives) return;

          if (over) {
            cancelClose();
            setOpen(true);
            return;
          }

          // Away: close after a grace period, so crossing a gap between the
          // panel and something next to it does not dismiss it.
          if (closeTimer.current !== null) return;
          closeTimer.current = window.setTimeout(() => {
            closeTimer.current = null;
            // Typing counts as using it. The composer sits at the bottom edge,
            // so the pointer is often outside while a reply is half-written.
            const focused = document.activeElement;
            if (
              focused instanceof HTMLInputElement ||
              focused instanceof HTMLTextAreaElement
            ) {
              return;
            }
            setOpen(false);
          }, HOVER_CLOSE_MS);
        })
        .catch(() => {
          // Not under Tauri, or a transient failure while displays change.
          // Losing one sample must not kill the interval.
        });
    }, CURSOR_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      cancelClose();
    };
  }, [onScreen, hoverDrives, followCursor, cancelClose, setOpen]);

  // The rail is a decorationless window, so the title bar has to move it. Same
  // handler Hive's own bar uses; buttons are excluded or dragging would eat the
  // clicks on the chips and the detach button.
  //
  // Only while the rail is not following the cursor: the follow poll owns the
  // position, so a drag would snap back within 250ms — a broken affordance is
  // worse than none.
  const startDrag = (e: React.MouseEvent) => {
    if (followCursor) return;
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    invoke("start_dragging").catch((err) => {
      console.error("[hive] start_dragging failed:", err);
    });
  };

  return (
    <div
      className="h-screen w-screen overflow-hidden hub-material"
      // No ground of its own: each surface below paints once, at its own
      // opacity, so the panel and sidebar settings stay independent of each
      // other. The window itself is transparent, which is what lets an alpha
      // here show the desktop rather than rendering white.
      style={{ background: "transparent" }}
      data-testid="rail-root"
    >
      {open ? (
        <div
          className="flex flex-col h-full rail-slide-in"
          data-anchor-side={anchorSide}
          style={{ background: withOpacity("var(--hub-bg-solid, #141414)", panelOpacity) }}
        >
          <div
            data-tauri-drag-region
            onMouseDown={startDrag}
            className="flex items-center gap-2 px-2.5 py-1.5 shrink-0 select-none"
            style={{ borderBottom: "1px solid var(--hub-hair)" }}
          >
            <span className="text-[12px] font-semibold" style={{ color: "var(--hub-text)" }}>
              {combined ? "Hive" : "Rail"}
            </span>
            <span className="flex-1" />
            <PlanUsageChip />
            <GlobalUsage />
            {combined && <DetachHiveButton />}
            <RailChrome onCollapse={() => setOpen(false)} />
          </div>
          <RailPanes />
        </div>
      ) : (
        <RailNub onOpen={() => setOpen(true)} />
      )}
    </div>
  );
}
