import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useHubStore } from "../stores/hubStore";
import { SessionPill } from "./SessionPill";
import { api } from "../api";
import type { Session, SessionViewMode } from "../types";

function displayName(session: Session): string {
  return session.customName || session.projectName;
}

function InlineRename({ session, className, style }: {
  session: Session;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const save = async () => {
    setEditing(false);
    const trimmed = value.trim();
    const name = trimmed === session.projectName ? "" : trimmed;
    await fetch(`${api.baseUrl}/api/sessions/${session.id}/name`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    // Update local store
    useHubStore.getState().renameSession(session.id, name || null);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        onKeyUp={(e) => {
          e.stopPropagation();
          if (e.key === " ") e.preventDefault();
        }}
        className={className}
        style={{
          ...style,
          background: "var(--hub-surface, rgba(255,255,255,0.1))",
          border: "1px solid var(--hub-accent, #60a5fa)",
          borderRadius: 4,
          outline: "none",
          padding: "0 4px",
          width: "100%",
          maxWidth: 180,
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <>
      <span className={className} style={style}>
        {displayName(session)}
      </span>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          setValue(displayName(session));
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            e.preventDefault();
            setValue(displayName(session));
            setEditing(true);
          }
        }}
        className="shrink-0 opacity-0 group-hover:opacity-40 hover:!opacity-90 transition-opacity cursor-pointer"
        title="Rename session"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--hub-text-muted, #777)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
      </span>
    </>
  );
}

const statusLegend = [
  { color: "#60a5fa", label: "Running", desc: "Actively working" },
  { color: "#eab308", label: "Waiting", desc: "Needs your input" },
  { color: "#a78bfa", label: "Thinking", desc: "Processing / reasoning" },
  { color: "#ef4444", label: "Error", desc: "Something went wrong" },
  { color: "#22c55e", label: "Idle", desc: "Done, ready" },
];

const statusColors: Record<string, string> = {
  running: "#60a5fa",
  waiting_for_input: "#eab308",
  thinking: "#a78bfa",
  error: "#ef4444",
  idle: "#22c55e",
};

const viewModeIcons: Record<SessionViewMode, string> = {
  grid: "▦",
  list: "☰",
  detailed: "▤",
};

// ── Grid View: wrapping pills ──────────────────────────────────────────

function GridView({ sessions }: { sessions: Session[] }) {
  const setActiveSession = useHubStore((s) => s.setActiveSession);
  const unreadSessions = useHubStore((s) => s.unreadSessions);

  return (
    <div className="flex flex-wrap gap-1.5 p-2">
      {sessions.map((session) => (
        <SessionPill
          key={session.id}
          name={displayName(session)}
          status={session.status}
          hasUnread={unreadSessions.has(session.id)}
          windowHandle={session.windowHandle}
          onClick={() => setActiveSession(session.id)}
        />
      ))}
    </div>
  );
}

// ── List View: compact one-line rows ───────────────────────────────────

function ListView({ sessions }: { sessions: Session[] }) {
  const setActiveSession = useHubStore((s) => s.setActiveSession);
  const unreadSessions = useHubStore((s) => s.unreadSessions);

  return (
    <div className="p-1 space-y-0.5">
      {sessions.map((session) => {
        const hasUnread = unreadSessions.has(session.id);
        const borderColor = statusColors[session.status];
        const borderDim = `${statusColors[session.status]}44`;
        return (
          <button
            key={session.id}
            onClick={() => setActiveSession(session.id)}
            className="group flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-md transition-colors hover:brightness-125 status-border-pulse"
            style={{
              background: "transparent",
              border: `1px solid ${borderColor}`,
              "--pulse-color": borderColor,
              "--pulse-color-dim": borderDim,
            } as React.CSSProperties}
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${session.status === "waiting_for_input" ? "animate-pulse" : ""}`}
              style={{ background: statusColors[session.status] }}
            />
            <InlineRename
              session={session}
              className="text-[11px] font-medium flex-1 truncate"
              style={{ color: "var(--hub-text, #e5e5e5)" }}
            />
            {hasUnread && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="shrink-0 animate-pulse">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25-3 6.5-3 6.5h20s-3-1.25-3-6.5c0-3.87-3.13-7-7-7z" fill="#ef4444"/>
                <circle cx="18" cy="5" r="4" fill="#ef4444"/>
              </svg>
            )}
            {session.windowHandle && (
              <span
                role="button"
                tabIndex={0}
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const { invoke } = await import("@tauri-apps/api/core");
                    await invoke("navigate_to_session", {
                      sessionHandle: session.windowHandle,
                    });
                  } catch {}
                }}
                className="text-[9px] rounded px-1 py-0.5 transition-opacity hover:opacity-80 cursor-pointer"
                style={{
                  background: "var(--hub-surface)",
                  border: "1px solid var(--hub-border)",
                  color: "var(--hub-text-muted)",
                }}
              >
                &#8599;
              </span>
            )}
            <span
              className="text-[9px] shrink-0"
              style={{ color: "var(--hub-text-muted)" }}
            >
              {formatTimeAgo(session.lastActivity)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Detailed View: full cards with messages ─────────────────────────────

function DetailedView({ sessions }: { sessions: Session[] }) {
  return (
    <div className="p-2 space-y-1">
      {sessions.map((session) => (
        <DetailedRow key={session.id} session={session} />
      ))}
    </div>
  );
}

function DetailedRow({ session }: { session: Session }) {
  const messages = useHubStore((s) => s.messages[session.id]);
  const setActiveSession = useHubStore((s) => s.setActiveSession);
  const hasUnread = useHubStore((s) => s.unreadSessions.has(session.id));
  const lastMessage = messages?.[messages.length - 1];
  const isAttention =
    session.status === "waiting_for_input" || session.status === "error";
  const borderColor = statusColors[session.status];
  const borderDim = `${statusColors[session.status]}44`;

  return (
    <button
      onClick={() => setActiveSession(session.id)}
      className="group flex items-start gap-2.5 rounded-lg px-3 py-2.5 w-full text-left transition-colors status-border-pulse"
      style={{
        background: isAttention
          ? "rgba(234, 179, 8, 0.08)"
          : "var(--hub-surface)",
        border: `1px solid ${borderColor}`,
        "--pulse-color": borderColor,
        "--pulse-color-dim": borderDim,
      } as React.CSSProperties}
    >
      <span
        className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
          session.status === "waiting_for_input" ? "animate-pulse" : ""
        }`}
        style={{ background: statusColors[session.status] }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <InlineRename
              session={session}
              className="text-xs font-medium"
              style={{
                color: isAttention ? "#fbbf24" : "var(--hub-text)",
              }}
            />
            {hasUnread && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0 animate-pulse">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25-3 6.5-3 6.5h20s-3-1.25-3-6.5c0-3.87-3.13-7-7-7z" fill="#ef4444"/>
                <path d="M9.5 19c.5 1.5 1.5 2.5 2.5 2.5s2-1 2.5-2.5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="18" cy="5" r="4" fill="#ef4444"/>
              </svg>
            )}
          </span>
          <div className="flex items-center gap-1.5">
            {session.windowHandle && (
              <span
                role="button"
                tabIndex={0}
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const { invoke } = await import("@tauri-apps/api/core");
                    await invoke("navigate_to_session", {
                      sessionHandle: session.windowHandle,
                    });
                  } catch {}
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    e.preventDefault();
                    import("@tauri-apps/api/core")
                      .then(({ invoke }) =>
                        invoke("navigate_to_session", {
                          sessionHandle: session.windowHandle,
                        })
                      )
                      .catch(() => {});
                  }
                }}
                className="text-[10px] rounded px-1 py-0.5 transition-opacity hover:opacity-80 cursor-pointer"
                style={{
                  background: "var(--hub-surface)",
                  border: "1px solid var(--hub-border)",
                  color: "var(--hub-text-muted)",
                }}
                title="Go to session desktop"
              >
                &#8599;
              </span>
            )}
            <span
              className="text-[10px]"
              style={{ color: "var(--hub-text-muted)" }}
            >
              {formatTimeAgo(session.lastActivity)}
            </span>
          </div>
        </div>
        {(lastMessage || session.statusDetail) && (
          <p
            className="text-[11px] mt-0.5 truncate"
            style={{
              color: isAttention
                ? "rgba(234, 179, 8, 0.7)"
                : "var(--hub-text-muted)",
            }}
          >
            {lastMessage?.content ?? session.statusDetail}
          </p>
        )}
      </div>
    </button>
  );
}

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ── Main Dashboard ─────────────────────────────────────────────────────

const STORAGE_KEY = "claude-hive-view-mode";

export function ExpandedDashboard() {
  const sessions = useHubStore((s) => s.sessions);
  const setViewState = useHubStore((s) => s.setViewState);
  const [showLegend, setShowLegend] = useState(false);
  const [viewMode, setViewMode] = useState<SessionViewMode>(() => {
    return (localStorage.getItem(STORAGE_KEY) as SessionViewMode) || "detailed";
  });

  const cycleView = () => {
    const modes: SessionViewMode[] = ["grid", "list", "detailed"];
    const next = modes[(modes.indexOf(viewMode) + 1) % modes.length];
    setViewMode(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <div
      className="rounded-xl overflow-hidden shadow-xl flex flex-col"
      style={{
        background: "var(--hub-bg)",
        border: "1px solid var(--hub-border)",
        backdropFilter: "var(--hub-blur)",
        WebkitBackdropFilter: "var(--hub-blur)",
        width: "100%",
        height: "100%",
      }}
    >
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0"
        style={{ borderColor: "var(--hub-border, #333)" }}
      >
        <div className="relative">
          <button
            onClick={() => setShowLegend(!showLegend)}
            className="text-[10px] opacity-40 hover:opacity-70 transition-opacity px-1.5 py-0.5 rounded"
            style={{
              color: "var(--hub-text, #e5e5e5)",
              background: showLegend ? "var(--hub-surface, rgba(255,255,255,0.06))" : "transparent",
            }}
          >
            ? Legend
          </button>
          {showLegend && createPortal(
            <div
              style={{
                position: "fixed",
                left: 12,
                top: 72,
                background: "var(--hub-bg-solid, #1a1a1a)",
                border: "1px solid var(--hub-border, #333)",
                minWidth: 180,
                borderRadius: 8,
                padding: 12,
                boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                zIndex: 99999,
              }}
            >
              <p
                className="text-[10px] font-medium mb-2"
                style={{ color: "var(--hub-text, #e5e5e5)" }}
              >
                Status Colors
              </p>
              {statusLegend.map((item) => (
                <div key={item.label} className="flex items-center gap-2 py-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: item.color }}
                  />
                  <span className="text-[11px]" style={{ color: "var(--hub-text, #e5e5e5)" }}>
                    {item.label}
                  </span>
                  <span className="text-[10px] ml-auto" style={{ color: "var(--hub-text-muted, #777)" }}>
                    {item.desc}
                  </span>
                </div>
              ))}
            </div>,
            document.body
          )}
        </div>

        {/* View mode toggle */}
        <button
          onClick={cycleView}
          className="text-[10px] opacity-40 hover:opacity-70 transition-opacity px-1.5 py-0.5 rounded"
          style={{ color: "var(--hub-text, #e5e5e5)" }}
          title={`View: ${viewMode} (click to cycle)`}
        >
          {viewModeIcons[viewMode]} {viewMode.charAt(0).toUpperCase() + viewMode.slice(1)}
        </button>

        <div className="flex-1" />
        <button
          onClick={() => setViewState("settings")}
          className="text-[10px] opacity-40 hover:opacity-70 transition-opacity px-1.5 py-0.5 rounded"
          style={{ color: "var(--hub-text, #e5e5e5)" }}
        >
          &#9881; Settings
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {sessions.length === 0 ? (
          <div className="py-8 text-center">
            <p
              className="text-xs"
              style={{ color: "var(--hub-text-muted)" }}
            >
              No sessions connected
            </p>
            <p
              className="text-[10px] mt-1"
              style={{ color: "var(--hub-text-muted)" }}
            >
              Open a Claude Code session to get started
            </p>
          </div>
        ) : viewMode === "grid" ? (
          <GridView sessions={sessions} />
        ) : viewMode === "list" ? (
          <ListView sessions={sessions} />
        ) : (
          <DetailedView sessions={sessions} />
        )}
      </div>
    </div>
  );
}
