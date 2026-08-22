import { useHubStore } from "../stores/hubStore";
import { InlineRename } from "./InlineRename";
import type { Session, SessionStatus } from "../types";

const statusColors: Record<SessionStatus, string> = {
  running: "#60a5fa",
  waiting_for_input: "#eab308",
  thinking: "#a78bfa",
  error: "#ef4444",
  idle: "#22c55e",
};

// A blocked session outranks everything, whatever the timestamp says. This is
// the pin that stops a busy feed burying the one row that needs the user —
// and it is where agent posts will slot in behind sessions in phase 3.
const URGENCY: Record<SessionStatus, number> = {
  waiting_for_input: 0,
  error: 1,
  running: 2,
  thinking: 3,
  idle: 4,
};

function byUrgencyThenRecency(a: Session, b: Session) {
  const rank = URGENCY[a.status] - URGENCY[b.status];
  if (rank !== 0) return rank;
  return (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "");
}

async function goToSession(handle: number) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("navigate_to_session", { sessionHandle: handle });
  } catch (err) {
    // Usually a stale HWND — the terminal was restarted. Surfacing it beats a
    // click that silently does nothing.
    console.error("[hive] navigate_to_session failed:", err);
  }
}

export function RailPanel() {
  const sessions = useHubStore((s) => s.sessions);
  const setActiveSession = useHubStore((s) => s.setActiveSession);
  const ordered = [...sessions].sort(byUrgencyThenRecency);

  return (
    <div className="flex flex-col h-full">
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 px-3 py-2 shrink-0 select-none"
        style={{ borderBottom: "1px solid var(--hub-hair)" }}
      >
        <span className="text-[12px] font-semibold" style={{ color: "var(--hub-text)" }}>
          Rail
        </span>
        <span className="text-[11px]" style={{ color: "var(--hub-text-muted)" }}>
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5">
        {ordered.length === 0 && (
          <span className="text-[11px] px-2 py-3" style={{ color: "var(--hub-text-muted)" }}>
            No sessions connected
          </span>
        )}

        {ordered.map((session) => {
          const needsAttention =
            session.status === "waiting_for_input" || session.status === "error";
          return (
            <div
              key={session.id}
              data-testid="rail-row"
              data-attention={needsAttention ? "true" : undefined}
              className="flex gap-2 px-2 py-1.5 rounded-lg"
              style={{
                background: needsAttention ? "var(--hub-attention)" : "transparent",
              }}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
                  needsAttention ? "animate-pulse" : ""
                }`}
                style={{ background: statusColors[session.status] }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveSession(session.id)}
                    className="text-[12px] font-semibold truncate text-left"
                    style={{
                      background: "none",
                      border: 0,
                      color: "var(--hub-text)",
                      padding: 0,
                      cursor: "pointer",
                    }}
                  >
                    <InlineRename session={session} revealOnHover={false} />
                  </button>
                  {session.windowHandle && (
                    <button
                      type="button"
                      title="Go to session desktop"
                      onClick={() => void goToSession(session.windowHandle!)}
                      className="text-[10px] rounded px-1 shrink-0"
                      style={{
                        background: "var(--hub-surface)",
                        border: 0,
                        color: "var(--hub-text-muted)",
                        cursor: "pointer",
                      }}
                    >
                      &#8599;
                    </button>
                  )}
                </div>
                {session.statusDetail && (
                  <div
                    className="text-[11px] leading-snug"
                    style={{ color: "var(--hub-text-muted)" }}
                  >
                    {session.statusDetail}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
