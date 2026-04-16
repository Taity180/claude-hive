import type { SessionStatus } from "../types";

const statusColors: Record<SessionStatus, string> = {
  running: "#60a5fa",
  waiting_for_input: "#eab308",
  thinking: "#a78bfa",
  error: "#ef4444",
  idle: "#22c55e",
};

interface SessionPillProps {
  name: string;
  status: SessionStatus;
  hasUnread?: boolean;
  windowHandle?: number | null;
  onClick: () => void;
}

export function SessionPill({ name, status, hasUnread, windowHandle, onClick }: SessionPillProps) {
  const color = statusColors[status];
  const isPulsing = status === "waiting_for_input" || status === "error";
  const borderColor = color;
  const borderDim = `${color}44`;

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] whitespace-nowrap transition-colors hover:brightness-125 status-border-pulse`}
      style={{
        background: "var(--hub-surface)",
        border: `1px solid ${borderColor}`,
        color: "var(--hub-text-muted)",
        "--pulse-color": borderColor,
        "--pulse-color-dim": borderDim,
      } as React.CSSProperties}
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${isPulsing ? "animate-pulse" : ""}`}
        style={{ background: color }}
      />
      {name}
      {hasUnread && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="shrink-0 animate-pulse">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25-3 6.5-3 6.5h20s-3-1.25-3-6.5c0-3.87-3.13-7-7-7z" fill="#ef4444"/>
          <circle cx="18" cy="5" r="4" fill="#ef4444"/>
        </svg>
      )}
      {windowHandle && (
        <span
          role="button"
          tabIndex={0}
          onClick={async (e) => {
            e.stopPropagation();
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("navigate_to_session", { sessionHandle: windowHandle });
            } catch {}
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              import("@tauri-apps/api/core")
                .then(({ invoke }) => invoke("navigate_to_session", { sessionHandle: windowHandle }))
                .catch(() => {});
            }
          }}
          className="text-[9px] rounded px-0.5 transition-opacity opacity-40 hover:!opacity-90 cursor-pointer"
          style={{ color: "var(--hub-text-muted)" }}
          title="Go to session desktop"
        >
          &#8599;
        </span>
      )}
    </button>
  );
}
