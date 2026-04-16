import { useHubStore } from "../stores/hubStore";
import { SessionPill } from "./SessionPill";

export function CollapsedBar() {
  const sessions = useHubStore((s) => s.sessions);
  const setActiveSession = useHubStore((s) => s.setActiveSession);
  const unreadSessions = useHubStore((s) => s.unreadSessions);

  const needsAttention = sessions.filter(
    (s) => s.status === "waiting_for_input" || s.status === "error"
  );

  return (
    <div className="px-3 py-2 overflow-y-auto">
      <div className="flex flex-wrap gap-1.5 items-center">
        {sessions.map((session) => (
          <SessionPill
            key={session.id}
            name={session.customName || session.projectName}
            status={session.status}
            hasUnread={unreadSessions.has(session.id)}
            windowHandle={session.windowHandle}
            onClick={() => setActiveSession(session.id)}
          />
        ))}
        {sessions.length === 0 && (
          <span
            className="text-[11px]"
            style={{ color: "var(--hub-text-muted, #777)" }}
          >
            No sessions connected
          </span>
        )}
      </div>

      {needsAttention.length > 0 && (
        <div
          className="flex items-center gap-1 rounded-md px-2 py-1 mt-1.5 w-fit"
          style={{
            background: "rgba(234, 179, 8, 0.15)",
            border: "1px solid rgba(234, 179, 8, 0.2)",
          }}
        >
          <span className="text-[11px] font-medium text-amber-400">
            {needsAttention.length} waiting
          </span>
        </div>
      )}
    </div>
  );
}
