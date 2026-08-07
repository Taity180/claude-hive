import { useState } from "react";
import { useHubStore } from "../stores/hubStore";
import { api } from "../api";
import type { Question } from "../types";

interface QuestionPromptProps {
  question: Question;
  /**
   * `compact` is the collapsed bar: no room for a heading, so the question
   * carries itself and the options sit on one wrapping row.
   */
  variant?: "full" | "compact";
}

/**
 * The option buttons for a question a session is blocked on. Clicking one
 * releases the session's `hub_ask` call, so this is the one control in the
 * dashboard that directly unblocks work.
 */
export function QuestionPrompt({ question, variant = "full" }: QuestionPromptProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const compact = variant === "compact";

  const send = async (answer: string[]) => {
    if (answer.length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      const resp = await fetch(
        `${api.baseUrl}/api/sessions/${question.sessionId}/ask/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, answer }),
        },
      );
      if (!resp.ok) {
        // Most likely the session moved on and asked something else, or another
        // window answered first. Say so rather than leaving a dead button.
        setError(await resp.text());
        setSending(false);
        return;
      }
      // The questionAnswered event clears this prompt from the store, so there
      // is nothing to reset here — the component unmounts.
      useHubStore.getState().handleWsEvent({
        type: "questionAnswered",
        sessionId: question.sessionId,
        questionId: question.id,
        answer,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send answer");
      setSending(false);
    }
  };

  const toggle = (option: string) => {
    setSelected((current) =>
      current.includes(option)
        ? current.filter((o) => o !== option)
        : [...current, option],
    );
  };

  return (
    <div
      className={compact ? "w-full" : "rounded-lg p-2.5 mb-2"}
      style={
        compact
          ? undefined
          : {
              background: "rgba(234, 179, 8, 0.08)",
              border: "1px solid rgba(234, 179, 8, 0.25)",
            }
      }
    >
      <p
        className={compact ? "text-[11px] mb-1" : "text-[11px] font-medium mb-2"}
        style={{ color: compact ? "var(--hub-text)" : "#fbbf24" }}
      >
        {question.question}
      </p>

      <div className="flex flex-wrap gap-1">
        {question.options.map((option) => {
          const isSelected = selected.includes(option);
          return (
            <button
              key={option}
              disabled={sending}
              onClick={() =>
                question.multiSelect ? toggle(option) : send([option])
              }
              aria-pressed={question.multiSelect ? isSelected : undefined}
              className="rounded-md px-2 py-1 text-[10px] transition-colors hover:brightness-125 disabled:opacity-50 cursor-pointer"
              style={{
                background: isSelected
                  ? "rgba(234, 179, 8, 0.25)"
                  : "var(--hub-surface)",
                border: `1px solid ${isSelected ? "#eab308" : "var(--hub-border)"}`,
                color: "var(--hub-text)",
              }}
            >
              {option}
            </button>
          );
        })}

        {question.multiSelect && (
          <button
            disabled={sending || selected.length === 0}
            onClick={() => send(selected)}
            className="rounded-md px-2 py-1 text-[10px] transition-opacity hover:opacity-80 disabled:opacity-30 cursor-pointer"
            style={{
              background: "var(--hub-accent)",
              color: "var(--hub-accent-text, #0a0a0a)",
              border: "1px solid transparent",
            }}
          >
            Send{selected.length > 0 ? ` (${selected.length})` : ""}
          </button>
        )}
      </div>

      {error && (
        <p className="text-[10px] mt-1" style={{ color: "#ef4444" }}>
          {error}
        </p>
      )}
    </div>
  );
}
