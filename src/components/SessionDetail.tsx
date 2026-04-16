import { useEffect, useRef } from "react";
import { useHubStore } from "../stores/hubStore";
import { ChatMessage } from "./ChatMessage";
import { api } from "../api";
import type { Message } from "../types";

const statusLabels: Record<string, string> = {
  running: "Running",
  waiting_for_input: "Waiting for input",
  thinking: "Thinking",
  error: "Error",
  idle: "Idle",
};

const statusColors: Record<string, string> = {
  running: "#60a5fa",
  waiting_for_input: "#eab308",
  thinking: "#a78bfa",
  error: "#ef4444",
  idle: "#22c55e",
};

const EMPTY_MESSAGES: Message[] = [];

export function SessionDetail() {
  const activeSessionId = useHubStore((s) => s.activeSessionId);
  const sessions = useHubStore((s) => s.sessions);
  const messages = useHubStore((s) =>
    activeSessionId ? s.messages[activeSessionId] : undefined
  ) ?? EMPTY_MESSAGES;
  const setActiveSession = useHubStore((s) => s.setActiveSession);
  const scrollRef = useRef<HTMLDivElement>(null);

  const session = sessions.find((s) => s.id === activeSessionId);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!activeSessionId) return;
    const baseUrl = api.baseUrl;
    fetch(
      `${baseUrl}/api/sessions/${activeSessionId}/messages`
    )
      .then((r) => r.json())
      .then((msgs) => useHubStore.getState().setMessages(activeSessionId, msgs))
      .catch(() => {});
  }, [activeSessionId]);

  if (!session) {
    return (
      <div
        className="flex items-center justify-center rounded-xl"
        style={{
          background: "var(--hub-bg-solid, #1a1a1a)",
          width: "100%",
          height: "100%",
          minHeight: 300,
        }}
      >
        <div className="text-center">
          <p style={{ color: "var(--hub-text, #e5e5e5)", fontSize: 14 }}>Session disconnected</p>
          <p style={{ color: "var(--hub-text-muted, #777)", fontSize: 12, marginTop: 4 }}>
            This session is no longer connected to the hub
          </p>
          <button
            onClick={() => setActiveSession(null)}
            style={{
              marginTop: 16,
              padding: "8px 20px",
              background: "var(--hub-accent, #60a5fa)",
              color: "var(--hub-accent-text, #0a0a0a)",
              borderRadius: 8,
              border: "none",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const connectedDuration = formatDuration(session.connectedAt);

  return (
    <div
      className="rounded-xl overflow-hidden shadow-xl flex flex-col"
      style={{
        background: "var(--hub-bg-solid, #141414)",
        border: "1px solid var(--hub-border, #333)",
        width: "100%",
        height: "100%",
      }}
    >
      {/* Session info bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b"
        style={{ borderColor: "var(--hub-border, #333)" }}
      >
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${session.status === "waiting_for_input" ? "animate-pulse" : ""}`}
          style={{ background: statusColors[session.status] }}
        />
        <span
          className="text-[13px] font-medium"
          style={{ color: "var(--hub-text, #e5e5e5)" }}
        >
          {session.customName || session.projectName}
        </span>
        <span
          className="text-[10px] rounded px-1.5 py-0.5"
          style={{
            color: statusColors[session.status],
            background: `${statusColors[session.status]}15`,
          }}
        >
          {statusLabels[session.status]}
        </span>
        <div className="flex-1" />
        {session.windowHandle && (
          <button
            onClick={async () => {
              try {
                const { invoke } = await import("@tauri-apps/api/core");
                await invoke("navigate_to_session", {
                  sessionHandle: session.windowHandle,
                });
              } catch {}
            }}
            className="text-[10px] rounded px-1.5 py-0.5 transition-opacity hover:opacity-80"
            style={{
              background: "var(--hub-surface, rgba(255,255,255,0.06))",
              border: "1px solid var(--hub-border, #333)",
              color: "var(--hub-text-muted, #777)",
            }}
          >
            Go to &#8599;
          </button>
        )}
      </div>

      <div
        className="flex gap-3 px-4 py-1.5 border-b text-[10px]"
        style={{
          borderColor: "var(--hub-border)",
          color: "var(--hub-text-muted)",
        }}
      >
        <span>Connected {connectedDuration}</span>
        {session.gitBranch && <span>Branch: {session.gitBranch}</span>}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length > 0 && (
          <div className="flex justify-end mb-2">
            <button
              onClick={async () => {
                await fetch(`${api.baseUrl}/api/sessions/${activeSessionId}/messages/clear`, {
                  method: "DELETE",
                });
                useHubStore.getState().clearMessages(activeSessionId!);
              }}
              className="text-[10px] rounded px-1.5 py-0.5 transition-opacity opacity-40 hover:opacity-80"
              style={{
                background: "var(--hub-surface, rgba(255,255,255,0.06))",
                border: "1px solid var(--hub-border, #333)",
                color: "var(--hub-text-muted, #777)",
              }}
            >
              Clear messages
            </button>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {messages.length === 0 && (
          <p
            className="text-center text-[11px] py-8"
            style={{ color: "var(--hub-text-muted)" }}
          >
            No messages yet
          </p>
        )}
      </div>

    </div>
  );
}

function formatDuration(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
