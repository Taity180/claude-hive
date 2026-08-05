import { useState } from "react";
import { InlineRename } from "./InlineRename";
import type { Session, SessionStatus } from "../types";

const statusColors: Record<SessionStatus, string> = {
  running: "#60a5fa",
  waiting_for_input: "#eab308",
  thinking: "#a78bfa",
  error: "#ef4444",
  idle: "#22c55e",
};

interface SessionPillProps {
  session: Session;
  hasUnread?: boolean;
  onClick: () => void;
}

export function SessionPill({ session, hasUnread, onClick }: SessionPillProps) {
  const [editing, setEditing] = useState(false);
  const { status, windowHandle } = session;
  const color = statusColors[status];
  const isPulsing = status === "waiting_for_input" || status === "error";
  const borderColor = color;
  const borderDim = `${color}44`;

  // The pill behaves as a button but is rendered as a div: a <button> may not
  // contain the <input> the rename field needs. Swapping the tag while editing
  // isn't an option either — React remounts on an element type change, which
  // would tear down the rename field the moment it opened.
  return (
    <div
      role={editing ? undefined : "button"}
      tabIndex={editing ? undefined : 0}
      onClick={editing ? undefined : onClick}
      onKeyDown={(e) => {
        if (!editing && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] whitespace-nowrap transition-colors status-border-pulse ${
        editing ? "" : "hover:brightness-125 cursor-pointer"
      }`}
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
      <InlineRename
        session={session}
        revealOnHover={false}
        onEditingChange={setEditing}
      />
      {hasUnread && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="shrink-0 animate-pulse">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25-3 6.5-3 6.5h20s-3-1.25-3-6.5c0-3.87-3.13-7-7-7z" fill="#ef4444"/>
          <circle cx="18" cy="5" r="4" fill="#ef4444"/>
        </svg>
      )}
      {windowHandle && !editing && (
        <span
          role="button"
          tabIndex={0}
          onClick={async (e) => {
            e.stopPropagation();
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("navigate_to_session", { sessionHandle: windowHandle });
            } catch (err) {
              // Most common cause: the stored HWND is stale (terminal
              // restarted, Windows Terminal tab shuffled, etc). Surfacing
              // the error tells the user to restart the session instead
              // of clicking into the void.
              console.error("[hive] navigate_to_session failed:", err);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              import("@tauri-apps/api/core")
                .then(({ invoke }) => invoke("navigate_to_session", { sessionHandle: windowHandle }))
                .catch((err) => {
                  console.error("[hive] navigate_to_session failed:", err);
                });
            }
          }}
          className="text-[9px] rounded px-0.5 transition-opacity opacity-40 hover:!opacity-90 cursor-pointer"
          style={{ color: "var(--hub-text-muted)" }}
          title="Go to session desktop"
        >
          &#8599;
        </span>
      )}
    </div>
  );
}
