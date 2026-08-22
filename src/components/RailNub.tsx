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
  const agentPosts = useHubStore((s) => s.agentPosts);
  const restingForm = useRailStore((s) => s.restingForm);

  const present = STATUS_ORDER.filter((status) =>
    sessions.some((s) => s.status === status)
  );

  // Unread counts both halves of the feed. Counting only sessions left the nub
  // completely blank while agents were posting, which reads as broken.
  const unreadPosts = agentPosts.filter((p) => !p.read).length;
  const unreadCount = unread.size + unreadPosts;

  const hasAgentActivity = agentPosts.length > 0;
  // Nothing connected and nothing posted: show the mark rather than an empty
  // bar, so a resting rail still looks like a thing that works.
  const isIdle = present.length === 0 && !hasAgentActivity;
  const isSliver = restingForm === "sliver";
  const dotSize = isSliver ? 5 : 7;

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
      {isIdle && (
        <svg
          data-testid="rail-idle-mark"
          width={isSliver ? 10 : 16}
          height={isSliver ? 10 : 16}
          viewBox="0 0 512 512"
          aria-hidden="true"
          style={{ opacity: 0.55 }}
        >
          <circle cx="256" cy="256" r="60" fill="var(--hub-accent, #60a5fa)" />
          <circle cx="256" cy="96" r="34" fill="var(--hub-text-muted, #777)" />
          <circle cx="394" cy="176" r="34" fill="var(--hub-text-muted, #777)" />
          <circle cx="394" cy="336" r="34" fill="var(--hub-text-muted, #777)" />
          <circle cx="256" cy="416" r="34" fill="var(--hub-text-muted, #777)" />
          <circle cx="118" cy="336" r="34" fill="var(--hub-text-muted, #777)" />
          <circle cx="118" cy="176" r="34" fill="var(--hub-text-muted, #777)" />
        </svg>
      )}

      {present.map((status) => (
        <span
          key={status}
          data-testid="status-dot"
          className={`rounded-full shrink-0 ${
            status === "waiting_for_input" || status === "error" ? "animate-pulse" : ""
          }`}
          style={{
            background: statusColors[status],
            width: dotSize,
            height: dotSize,
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

      {/* Agents are monochrome everywhere, including here. */}
      {hasAgentActivity && (
        <span
          data-testid="agent-marker"
          className="shrink-0 grid place-items-center rounded"
          style={{
            width: isSliver ? 8 : 14,
            height: isSliver ? 8 : 14,
            background: "#f2f4f8",
          }}
        >
          {!isSliver && (
            <svg width="9" height="9" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 3l9 16H3z"
                fill="none"
                stroke="#16181c"
                strokeWidth="2.6"
                strokeLinejoin="round"
              />
            </svg>
          )}
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
