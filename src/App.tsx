import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useHubStore } from "./stores/hubStore";
import { useWebSocket } from "./hooks/useWebSocket";
import { useTheme } from "./hooks/useTheme";
import { CollapsedBar } from "./components/CollapsedBar";
import { ExpandedDashboard } from "./components/ExpandedDashboard";
import { SessionDetail } from "./components/SessionDetail";
import { Settings } from "./components/Settings";

// Vertical padding contributed by the scroll wrapper (`p-1` → 4px top + 4px bottom).
// Kept in one place so the sizing math stays in sync with the JSX below.
const SCROLL_WRAPPER_PADDING_Y = 8;

async function invokeCommand<T = void>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  try {
    return (await invoke(cmd, args)) as T;
  } catch (err) {
    console.error(`[hive] invoke(${cmd}) failed:`, err);
    return null;
  }
}

interface WindowBarProps {
  barRef: React.RefObject<HTMLDivElement | null>;
  captureExpandedHeight: () => Promise<void>;
}

function WindowBar({ barRef, captureExpandedHeight }: WindowBarProps) {
  const viewState = useHubStore((s) => s.viewState);
  const setViewState = useHubStore((s) => s.setViewState);
  const setActiveSession = useHubStore((s) => s.setActiveSession);
  const sessions = useHubStore((s) => s.sessions);

  const handleMinimize = () => {
    void invokeCommand("minimize_window");
  };

  const handleClose = () => {
    void invokeCommand("hide_window");
  };

  const handleDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    void invokeCommand("start_dragging");
  };

  const handleCollapse = async () => {
    // Capture the user's current expanded height before collapsing so
    // "Expand" returns the window to exactly where they left it.
    await captureExpandedHeight();
    setViewState("collapsed");
  };

  const handleExpand = () => {
    // The expand effect in <App> restores the persisted height.
    setViewState("expanded");
  };

  return (
    <div
      ref={barRef}
      onMouseDown={handleDragStart}
      className="flex items-center gap-2 px-3 py-1.5 shrink-0 select-none cursor-grab active:cursor-grabbing"
      style={{
        background: "var(--hub-bg-solid, #111)",
        borderBottom: "1px solid var(--hub-border, #333)",
      }}
    >
      {/* App icon */}
      <svg width="16" height="16" viewBox="0 0 512 512" className="shrink-0">
        <defs>
          <linearGradient id="hive-bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#1d4ed8" />
          </linearGradient>
        </defs>
        <rect width="512" height="512" rx="96" ry="96" fill="url(#hive-bg)"/>
        <circle cx="256" cy="256" r="48" fill="white" opacity="0.95"/>
        <circle cx="256" cy="112" r="28" fill="white" opacity="0.8"/>
        <circle cx="380" cy="196" r="28" fill="white" opacity="0.8"/>
        <circle cx="380" cy="316" r="28" fill="white" opacity="0.8"/>
        <circle cx="256" cy="400" r="28" fill="white" opacity="0.8"/>
        <circle cx="132" cy="316" r="28" fill="white" opacity="0.8"/>
        <circle cx="132" cy="196" r="28" fill="white" opacity="0.8"/>
        <line x1="256" y1="208" x2="256" y2="140" stroke="white" strokeWidth="6" opacity="0.4"/>
        <line x1="296" y1="228" x2="354" y2="200" stroke="white" strokeWidth="6" opacity="0.4"/>
        <line x1="296" y1="284" x2="354" y2="312" stroke="white" strokeWidth="6" opacity="0.4"/>
        <line x1="256" y1="304" x2="256" y2="372" stroke="white" strokeWidth="6" opacity="0.4"/>
        <line x1="216" y1="284" x2="158" y2="312" stroke="white" strokeWidth="6" opacity="0.4"/>
        <line x1="216" y1="228" x2="158" y2="200" stroke="white" strokeWidth="6" opacity="0.4"/>
      </svg>

      <span
        className="text-[11px] font-medium"
        style={{ color: "var(--hub-text, #e5e5e5)" }}
      >
        Claude Hive
      </span>

      <span
        className="text-[10px]"
        style={{ color: "var(--hub-text-muted, #777)" }}
      >
        {sessions.length > 0
          ? `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`
          : ""}
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Navigation */}
      {viewState === "session-detail" && (
        <button
          onClick={() => setActiveSession(null)}
          className="text-[10px] px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
          style={{
            background: "var(--hub-surface, rgba(255,255,255,0.06))",
            color: "var(--hub-text-muted, #777)",
          }}
        >
          ← Back
        </button>
      )}
      {viewState === "settings" && (
        <button
          onClick={() => setViewState("expanded")}
          className="text-[10px] px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
          style={{
            background: "var(--hub-surface, rgba(255,255,255,0.06))",
            color: "var(--hub-text-muted, #777)",
          }}
        >
          ← Back
        </button>
      )}
      {viewState === "expanded" && (
        <button
          onClick={handleCollapse}
          className="text-[10px] px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
          style={{
            background: "var(--hub-surface, rgba(255,255,255,0.06))",
            color: "var(--hub-text-muted, #777)",
          }}
        >
          Collapse
        </button>
      )}
      {viewState === "collapsed" && (
        <button
          onClick={handleExpand}
          className="text-[10px] px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
          style={{
            background: "var(--hub-surface, rgba(255,255,255,0.06))",
            color: "var(--hub-text-muted, #777)",
          }}
        >
          Expand
        </button>
      )}

      {/* Window controls */}
      <div className="flex items-center gap-0.5 ml-1">
        <button
          onClick={handleMinimize}
          className="w-6 h-6 flex items-center justify-center rounded transition-colors hover:bg-white/10"
          style={{ color: "var(--hub-text-muted, #777)" }}
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          onClick={handleClose}
          className="w-6 h-6 flex items-center justify-center rounded transition-colors hover:bg-red-500/80 hover:text-white"
          style={{ color: "var(--hub-text-muted, #777)" }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function App() {
  useWebSocket();
  useTheme();

  const viewState = useHubStore((s) => s.viewState);
  const sessions = useHubStore((s) => s.sessions);
  const expandedHeight = useHubStore((s) => s.expandedHeight);
  const setExpandedHeight = useHubStore((s) => s.setExpandedHeight);

  const windowBarRef = useRef<HTMLDivElement>(null);
  const collapsedContentRef = useRef<HTMLDivElement>(null);

  // Update tray badge when attention count changes
  const attentionCount = sessions.filter(
    (s) => s.status === "waiting_for_input" || s.status === "error"
  ).length;

  useEffect(() => {
    void invokeCommand("update_tray_badge", { count: attentionCount });
  }, [attentionCount]);

  // Snapshot the current window height so "Expand" can later restore it.
  const captureExpandedHeight = useCallback(async () => {
    const size = await invokeCommand<[number, number]>("get_logical_size");
    if (size) {
      const [, height] = size;
      setExpandedHeight(height);
    }
  }, [setExpandedHeight]);

  // While collapsed, resize the OS window to hug the real pill content. Uses
  // a ResizeObserver so the window also tightens up when pills wrap onto a
  // different number of rows (width change, new session, etc).
  useEffect(() => {
    if (viewState !== "collapsed") return;
    const bar = windowBarRef.current;
    const content = collapsedContentRef.current;
    if (!bar || !content) return;

    let cancelled = false;
    const applyHeight = () => {
      if (cancelled) return;
      const height = Math.ceil(
        bar.offsetHeight + content.offsetHeight + SCROLL_WRAPPER_PADDING_Y
      );
      void invokeCommand("resize_preserving_width", { height });
    };

    applyHeight();
    const observer = new ResizeObserver(applyHeight);
    observer.observe(content);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [viewState, sessions.length]);

  // Whenever we're in a "big" view (expanded, session-detail, settings),
  // restore the user's last remembered expanded height. This means clicking
  // a session pill from collapsed mode auto-grows the window to fit the
  // message feed, rather than keeping the tiny collapsed height.
  useEffect(() => {
    if (viewState === "collapsed") return;
    void invokeCommand("resize_preserving_width", { height: expandedHeight });
  }, [viewState, expandedHeight]);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col" style={{ background: "var(--hub-bg-solid, #141414)" }}>
      <WindowBar barRef={windowBarRef} captureExpandedHeight={captureExpandedHeight} />
      <div className="flex-1 overflow-auto p-1">
        {viewState === "collapsed" && <CollapsedBar ref={collapsedContentRef} />}
        {viewState === "expanded" && <ExpandedDashboard />}
        {viewState === "session-detail" && <SessionDetail />}
        {viewState === "settings" && <Settings />}
      </div>
    </div>
  );
}

export default App;
