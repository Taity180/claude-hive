import { useEffect, useRef } from "react";
import { useHubStore } from "./stores/hubStore";
import { useWebSocket } from "./hooks/useWebSocket";
import { useTheme } from "./hooks/useTheme";
import { CollapsedBar } from "./components/CollapsedBar";
import { ExpandedDashboard } from "./components/ExpandedDashboard";
import { SessionDetail } from "./components/SessionDetail";
import { Settings } from "./components/Settings";

function WindowBar() {
  const viewState = useHubStore((s) => s.viewState);
  const setViewState = useHubStore((s) => s.setViewState);
  const setActiveSession = useHubStore((s) => s.setActiveSession);
  const sessions = useHubStore((s) => s.sessions);

  const invokeRef = useRef<((cmd: string) => Promise<void>) | null>(null);

  // Pre-load invoke so all window ops are instant
  useEffect(() => {
    import("@tauri-apps/api/core").then((mod) => {
      invokeRef.current = mod.invoke;
    }).catch(() => {});
  }, []);

  const handleMinimize = () => {
    invokeRef.current?.("minimize_window");
  };

  const handleClose = () => {
    invokeRef.current?.("hide_window");
  };

  const handleDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    invokeRef.current?.("start_dragging");
  };

  return (
    <div
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
          onClick={async () => {
            setViewState("collapsed");
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              const { currentMonitor } = await import("@tauri-apps/api/window");
              const monitor = await currentMonitor();
              const scaleFactor = monitor?.scaleFactor ?? 1;
              // Get current physical size to preserve width
              const win = (await import("@tauri-apps/api/window")).getCurrentWindow();
              const size = await win.outerSize();
              const currentWidth = size.width / scaleFactor;
              // Window bar ~34px + pill row ~28px per row + padding
              // Estimate: each row of pills is ~28px, with wrapping
              const sessionCount = sessions.length || 1;
              const pillsPerRow = Math.max(1, Math.floor(currentWidth / 120));
              const rows = Math.ceil(sessionCount / pillsPerRow);
              const contentHeight = rows * 30 + 16; // pills + padding
              const waitingBanner = sessions.some(s => s.status === "waiting_for_input" || s.status === "error") ? 32 : 0;
              const totalHeight = 34 + contentHeight + waitingBanner + 8;
              await invoke("resize_window", { width: currentWidth, height: Math.max(totalHeight, 70) });
            } catch {}
          }}
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
          onClick={async () => {
            setViewState("expanded");
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              const { currentMonitor } = await import("@tauri-apps/api/window");
              const monitor = await currentMonitor();
              const scaleFactor = monitor?.scaleFactor ?? 1;
              const win = (await import("@tauri-apps/api/window")).getCurrentWindow();
              const size = await win.outerSize();
              const currentWidth = size.width / scaleFactor;
              await invoke("resize_window", { width: currentWidth, height: 520 });
            } catch {}
          }}
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

  // No auto-resize — user controls the window size.
  // Initial size is set in tauri.conf.json (500x520).

  // Update tray badge when attention count changes
  const attentionCount = sessions.filter(
    (s) => s.status === "waiting_for_input" || s.status === "error"
  ).length;

  useEffect(() => {
    async function updateBadge() {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("update_tray_badge", { count: attentionCount });
      } catch {}
    }
    updateBadge();
  }, [attentionCount]);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col" style={{ background: "var(--hub-bg-solid, #141414)" }}>
      <WindowBar />
      <div className="flex-1 overflow-auto p-1">
        {viewState === "collapsed" && <CollapsedBar />}
        {viewState === "expanded" && <ExpandedDashboard />}
        {viewState === "session-detail" && <SessionDetail />}
        {viewState === "settings" && <Settings />}
      </div>
    </div>
  );
}

export default App;
