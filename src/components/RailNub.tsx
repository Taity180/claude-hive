import { useHubStore } from "../stores/hubStore";
import { isHorizontalAnchor, useRailStore, withOpacity } from "../stores/railStore";
import { badgeCorner } from "./railBadge";
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
  const tasks = useHubStore((s) => s.tasks);
  const agentQuestions = useHubStore((s) => s.agentQuestions);
  const restingForm = useRailStore((s) => s.restingForm);
  const anchor = useRailStore((s) => s.anchor);
  const openOn = useRailStore((s) => s.openOn);
  const hideWhenIdle = useRailStore((s) => s.hideWhenIdle);
  const panelOpacity = useRailStore((s) => s.panelOpacity);

  const present = STATUS_ORDER.filter((status) =>
    sessions.some((s) => s.status === status)
  );

  // Unread counts both halves of the feed. Counting only sessions left the nub
  // completely blank while agents were posting, which reads as broken.
  const unreadPosts = agentPosts.filter((p) => !p.read).length;
  // A question counts as unread until answered: an agent is blocked on it, so it
  // is the last thing that should be invisible from a resting rail.
  const pendingQuestions = agentQuestions.filter((q) => q.answer === null).length;
  const unreadCount = unread.size + unreadPosts + pendingQuestions;

  const hasAgentActivity = agentPosts.length > 0;
  const openTasks = tasks.filter((t) => !t.done).length;
  // Nothing connected, nothing posted and nothing to do: show the mark rather
  // than an empty bar, so a resting rail still looks like a thing that works.
  const isIdle = present.length === 0 && !hasAgentActivity && openTasks === 0;

  // "Idle" for dimming is a different question: not "is there anything here" but
  // "does any of it need you". Keyed on existence, a single undated task kept
  // the rail lit forever, which made the setting untestable and useless.
  const overdueTasks = tasks.filter(
    (t) => !t.done && t.due !== null && new Date(t.due).getTime() < Date.now()
  ).length;
  const needsUser =
    sessions.some((s) => s.status === "waiting_for_input" || s.status === "error") ||
    unreadCount > 0 ||
    overdueTasks > 0;
  const isSliver = restingForm === "sliver";
  const dotSize = isSliver ? 5 : 7;

  // Dimmed, not hidden. A rail that vanishes entirely is one the user cannot
  // find again without going back to the Hive window.
  const dimmed = hideWhenIdle && !needsUser;
  // The rail is the same strip on any edge, just lying down on a horizontal
  // one — so its contents run along the edge rather than across it.
  const horizontal = isHorizontalAnchor(anchor);

  return (
    <button
      type="button"
      data-testid="rail-nub"
      onClick={onOpen}
      // Hover opens only when asked for: otherwise brushing past the screen
      // edge would open the panel by accident.
      onMouseEnter={openOn === "hover" ? onOpen : undefined}
      data-dimmed={dimmed ? "true" : undefined}
      data-orientation={horizontal ? "horizontal" : "vertical"}
      aria-label={
        unreadCount > 0 ? `Open Hive rail, ${unreadCount} unread` : "Open Hive rail"
      }
      className={`relative h-screen w-screen flex items-center justify-center gap-2 hub-material ${
        horizontal ? "flex-row" : "flex-col"
      }`}
      style={{
        // The resting strip is the window, so it follows the window setting.
        background: withOpacity("var(--hub-bg-solid, #141414)", panelOpacity),
        backdropFilter: "var(--hub-blur, blur(30px) saturate(180%))",
        border: 0,
        borderRadius: 0,
        cursor: "pointer",
        opacity: dimmed ? 0.35 : 1,
        transition: "opacity 200ms ease",
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

      {openTasks > 0 && (
        <span
          data-testid="nub-task-count"
          className={`flex items-center ${horizontal ? "flex-row gap-0.5" : "flex-col"}`}
          style={{ color: "var(--hub-text-muted)", fontSize: 9.5, lineHeight: 1.1 }}
        >
          {!isSliver && <span aria-hidden="true">✓</span>}
          <span className="font-bold tabular-nums" style={{ color: "#eab308" }}>
            {openTasks}
          </span>
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
            // Pinned inside the window, on the side facing the desktop. Hanging
            // it outside the frame got it clipped by the OS on a 32px nub.
            ...badgeCorner(anchor),
            minWidth: isSliver ? 8 : 16,
            height: isSliver ? 8 : 16,
            borderRadius: 999,
            fontSize: 10,
            lineHeight: 1,
            padding: isSliver ? 0 : "0 3px",
            boxShadow: "0 0 0 1.5px rgba(20,20,22,0.9)",
          }}
        >
          {isSliver ? "" : unreadCount}
        </span>
      )}
    </button>
  );
}
