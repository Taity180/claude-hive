import { useHubStore } from "../stores/hubStore";
import { useRailStore } from "../stores/railStore";
import type { SessionStatus } from "../types";

const statusColors: Record<SessionStatus, string> = {
  running: "#60a5fa",
  waiting_for_input: "#eab308",
  thinking: "#a78bfa",
  error: "#ef4444",
  idle: "#22c55e",
};

// Ordered by urgency rather than by session arrival, so the eye lands on the
// colour that matters first. One dot per distinct status, not per session —
// at 32px wide there is no room for eight dots, and the count carries the rest.
const STATUS_ORDER: SessionStatus[] = [
  "waiting_for_input",
  "error",
  "running",
  "thinking",
  "idle",
];

export function RailNub({ onOpen }: { onOpen: () => void }) {
  const sessions = useHubStore((s) => s.sessions);
  const unread = useHubStore((s) => s.unreadSessions);
  const restingForm = useRailStore((s) => s.restingForm);

  const present = STATUS_ORDER.filter((status) =>
    sessions.some((s) => s.status === status)
  );
  const unreadCount = unread.size;
  const isSliver = restingForm === "sliver";

  return (
    <button
      type="button"
      data-testid="rail-nub"
      onClick={onOpen}
      aria-label={
        unreadCount > 0 ? `Open Hive rail, ${unreadCount} unread` : "Open Hive rail"
      }
      className="relative h-screen w-screen flex flex-col items-center justify-center gap-2 hub-material"
      style={{
        background: "var(--hub-bg, rgba(20,20,20,0.75))",
        backdropFilter: "var(--hub-blur, blur(30px) saturate(180%))",
        border: 0,
        borderRadius: 0,
        cursor: "pointer",
      }}
    >
      {present.map((status) => (
        <span
          key={status}
          data-testid="status-dot"
          className={`rounded-full shrink-0 ${
            status === "waiting_for_input" || status === "error" ? "animate-pulse" : ""
          }`}
          style={{
            background: statusColors[status],
            width: isSliver ? 5 : 7,
            height: isSliver ? 5 : 7,
          }}
        />
      ))}

      {!isSliver && sessions.length > 0 && (
        <span
          className="font-bold tabular-nums"
          style={{ fontSize: 9.5, color: "var(--hub-text-muted)" }}
        >
          {sessions.length}
        </span>
      )}

      {unreadCount > 0 && (
        <span
          data-testid="unread-badge"
          className="absolute grid place-items-center font-bold tabular-nums"
          style={{
            // Red means "unread", not a status — deliberately outside the five
            // status colours, and it clears on open rather than on state change.
            background: "#ff453a",
            color: "#fff",
            top: isSliver ? -3 : -5,
            right: isSliver ? -3 : -5,
            minWidth: isSliver ? 9 : 15,
            height: isSliver ? 9 : 15,
            borderRadius: 999,
            fontSize: 9.5,
            padding: isSliver ? 0 : "0 4px",
            boxShadow: "0 0 0 1.5px rgba(20,20,22,0.9)",
          }}
        >
          {isSliver ? "" : unreadCount}
        </span>
      )}
    </button>
  );
}
