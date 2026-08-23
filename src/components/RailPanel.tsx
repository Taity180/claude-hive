import { useState } from "react";
import { useHubStore } from "../stores/hubStore";
import { useRailStore } from "../stores/railStore";
import { buildFeed } from "../feed/buildFeed";
import { AgentPostRow } from "./AgentPostRow";
import { AgentQuestionRow } from "./AgentQuestionRow";
import { ConnectedAppsBar } from "./ConnectedAppsBar";
import { InlineRename } from "./InlineRename";
import { RailComposer } from "./RailComposer";
import type { Session, SessionStatus } from "../types";

const statusColors: Record<SessionStatus, string> = {
  running: "#60a5fa",
  waiting_for_input: "#eab308",
  thinking: "#a78bfa",
  error: "#ef4444",
  idle: "#22c55e",
};

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

function SessionRow({ session }: { session: Session }) {
  const setActiveSession = useHubStore((s) => s.setActiveSession);
  const needsAttention =
    session.status === "waiting_for_input" || session.status === "error";

  return (
    <div
      data-testid="rail-row"
      data-row-kind="session"
      data-attention={needsAttention ? "true" : undefined}
      className="flex gap-2 px-2 py-1.5 rounded-lg"
      style={{ background: needsAttention ? "var(--hub-attention)" : "transparent" }}
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
            // A flex line, not a block: the rename pencil is an inline SVG and
            // `truncate` on a block button dropped it onto a line of its own
            // under the name.
            className="flex items-center gap-1 min-w-0 text-left"
            style={{
              background: "none",
              border: 0,
              color: "var(--hub-text)",
              padding: 0,
              cursor: "pointer",
            }}
          >
            <InlineRename
              session={session}
              className="text-[12px] font-semibold truncate"
              revealOnHover={false}
            />
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
          <div className="text-[11px] leading-snug" style={{ color: "var(--hub-text-muted)" }}>
            {session.statusDetail}
          </div>
        )}
      </div>
    </div>
  );
}

interface RailPanelProps {
  /**
   * Combined mode supplies the window's own title bar and a connector strip
   * above every pane, so the panel drops its own copies of both and takes the
   * app filter from above instead of owning it.
   */
  embedded?: boolean;
  selectedApp?: string | null;
  onSelectApp?: (appId: string | null) => void;
}

export function RailPanel({ embedded, selectedApp: controlled, onSelectApp }: RailPanelProps = {}) {
  const sessions = useHubStore((s) => s.sessions);
  const agentPosts = useHubStore((s) => s.agentPosts);
  const agents = useHubStore((s) => s.agents);
  const agentQuestions = useHubStore((s) => s.agentQuestions);
  const mutedApps = useRailStore((s) => s.mutedApps);
  const [ownSelectedApp, setOwnSelectedApp] = useState<string | null>(null);
  const selectedApp = onSelectApp ? (controlled ?? null) : ownSelectedApp;
  const setSelectedApp = onSelectApp ?? setOwnSelectedApp;

  // Ordering lives in buildFeed so it can be tested without rendering.
  const rows = buildFeed(sessions, agentPosts, {
    pinAttention: true,
    appId: selectedApp,
    mutedApps,
    questions: agentQuestions,
  });

  return (
    <div className="flex flex-col h-full">
      {!embedded && (
        <>
          <div
            data-tauri-drag-region
            className="flex items-center gap-2 px-3 py-2 shrink-0 select-none"
            style={{ borderBottom: "1px solid var(--hub-hair)" }}
          >
            <span className="text-[12px] font-semibold" style={{ color: "var(--hub-text)" }}>
              {selectedApp ?? "Rail"}
            </span>
            <span className="text-[11px]" style={{ color: "var(--hub-text-muted)" }}>
              {sessions.length} session{sessions.length === 1 ? "" : "s"}
            </span>
          </div>

          <ConnectedAppsBar selected={selectedApp} onSelect={setSelectedApp} />
        </>
      )}

      <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5">
        {rows.length === 0 && (
          <span className="text-[11px] px-2 py-3" style={{ color: "var(--hub-text-muted)" }}>
            {selectedApp ? "Nothing from this app yet" : "No sessions connected"}
          </span>
        )}

        {rows.map((row) =>
          row.kind === "session" ? (
            <SessionRow key={row.session.id} session={row.session} />
          ) : row.kind === "question" ? (
            <AgentQuestionRow key={row.question.id} question={row.question} />
          ) : (
            <AgentPostRow key={row.post.id} post={row.post} />
          )
        )}
      </div>

      <RailComposer agents={agents} />
    </div>
  );
}
