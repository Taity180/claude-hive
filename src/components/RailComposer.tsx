import { useCallback, useEffect, useState } from "react";
import { fetchPendingReplies, replyToAgent } from "../agentApi";
import type { Agent } from "../types";

/** How often to re-check whether the agent has collected its replies. */
const PENDING_POLL_MS = 5000;

export function RailComposer({ agents }: { agents: Agent[] }) {
  const target = agents[0] ?? null;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(0);
  const [sending, setSending] = useState(false);

  const refreshPending = useCallback(async () => {
    if (!target) return;
    setPending(await fetchPendingReplies(target.id));
  }, [target]);

  // Poll rather than listen: the agent draining its inbox happens on the
  // agent's side, and nothing pushes that fact back to us.
  useEffect(() => {
    if (!target) return;
    void refreshPending();
    const id = window.setInterval(() => void refreshPending(), PENDING_POLL_MS);
    return () => window.clearInterval(id);
  }, [target, refreshPending]);

  const send = async () => {
    const message = draft.trim();
    if (!target || !message || sending) return;

    setSending(true);
    const ok = await replyToAgent(target.id, message);
    setSending(false);

    // Only clear on success — losing what they typed to a failed request is
    // worse than making them press send again.
    if (ok) {
      setDraft("");
      void refreshPending();
    }
  };

  return (
    <div
      className="shrink-0 px-2 py-2 flex flex-col gap-1"
      style={{ borderTop: "1px solid var(--hub-hair)" }}
    >
      <div className="flex items-center gap-1.5">
        <span
          data-testid="composer-target"
          className="text-[10.5px] font-semibold shrink-0 rounded px-1.5 py-0.5"
          style={{
            background: target ? "rgba(10,132,255,0.2)" : "var(--hub-surface)",
            color: target ? "#9ecbff" : "var(--hub-text-muted)",
          }}
        >
          {target ? `@${target.name}` : "No agent connected"}
        </span>

        <input
          data-testid="composer-input"
          value={draft}
          disabled={!target}
          placeholder="Reply&hellip;"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
          className="flex-1 min-w-0 text-[11.5px] rounded-md px-2 py-1"
          style={{
            background: "rgba(0,0,0,0.24)",
            border: 0,
            boxShadow: "inset 0 0 0 1px var(--hub-hair)",
            color: "var(--hub-text)",
            outline: "none",
          }}
        />

        <button
          data-testid="composer-send"
          type="button"
          disabled={!target || sending}
          onClick={() => void send()}
          className="shrink-0 grid place-items-center rounded-md text-[12px]"
          style={{
            width: 24,
            height: 24,
            border: 0,
            background: target ? "var(--hub-accent)" : "var(--hub-surface)",
            color: target ? "var(--hub-accent-text)" : "var(--hub-text-muted)",
            cursor: target ? "pointer" : "default",
          }}
          aria-label="Send reply"
        >
          &uarr;
        </button>
      </div>

      {pending > 0 && (
        <span
          data-testid="composer-queued"
          className="text-[9.5px] flex items-center gap-1.5 px-1"
          style={{ color: "var(--hub-text-muted)" }}
        >
          <span
            aria-hidden="true"
            style={{ width: 5, height: 5, borderRadius: 999, background: "#eab308" }}
          />
          {pending} queued &mdash; collected on the agent&apos;s next check-in
        </span>
      )}
    </div>
  );
}
