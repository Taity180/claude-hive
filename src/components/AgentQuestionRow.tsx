import { useState } from "react";
import { answerAgentQuestion } from "../agentApi";
import { useHubStore } from "../stores/hubStore";
import { AppIcon } from "./AppIcon";
import type { AgentQuestion } from "../types";

/**
 * A question an agent is blocked on, answered by clicking.
 *
 * Tinted like a session that needs the user, because it is the same situation
 * from the user's side: something is waiting on them. The difference is that
 * clicking here is the entire interaction — there is no session to jump to.
 */
export function AgentQuestionRow({ question }: { question: AgentQuestion }) {
  const setAgentQuestions = useHubStore((s) => s.setAgentQuestions);
  const questions = useHubStore((s) => s.agentQuestions);
  const [sending, setSending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const answer = async (choice: string) => {
    setSending(choice);
    setFailed(false);
    const ok = await answerAgentQuestion(question.id, choice);
    if (ok) {
      // Drop it locally rather than waiting for the event: the click should feel
      // done immediately, and the websocket event is the other window's cue.
      setAgentQuestions(questions.filter((q) => q.id !== question.id));
      return;
    }
    // Leave the buttons live. A failed answer the user cannot retry would strand
    // the agent with no way back.
    setSending(null);
    setFailed(true);
  };

  return (
    <div
      data-testid="rail-row"
      data-row-kind="question"
      className="flex gap-2 px-2 py-1.5 rounded-lg"
      style={{ background: "var(--hub-attention)" }}
    >
      <span
        className="shrink-0 grid place-items-center rounded-md mt-0.5"
        style={{ width: 20, height: 20, background: "#f2f4f8" }}
      >
        {question.appId ? (
          <AppIcon slug={question.appId} size={12} />
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3l9 16H3z" fill="none" stroke="#16181c" strokeWidth="2.4" strokeLinejoin="round" />
          </svg>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-semibold truncate" style={{ color: "var(--hub-text)" }}>
            {question.agentName}
          </span>
          <span
            className="text-[8.5px] font-bold uppercase tracking-wide shrink-0 rounded px-1"
            style={{ background: "#e9ecf2", color: "#16181c" }}
          >
            Asking
          </span>
        </div>

        <div className="text-[11px] leading-snug" style={{ color: "var(--hub-text)" }}>
          {question.question}
        </div>

        <div className="flex flex-wrap gap-1 mt-1.5">
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              data-testid="question-option"
              disabled={sending !== null}
              onClick={() => void answer(option)}
              className="text-[11px] font-semibold rounded-md px-2 py-0.5 transition-opacity hover:opacity-80"
              style={{
                background: "var(--hub-accent)",
                color: "var(--hub-accent-text)",
                border: 0,
                cursor: sending === null ? "pointer" : "progress",
                opacity: sending !== null && sending !== option ? 0.5 : 1,
              }}
            >
              {option}
            </button>
          ))}
        </div>

        {failed && (
          <div className="text-[10.5px] mt-1" style={{ color: "var(--hub-text-muted)" }}>
            Could not send that — try again.
          </div>
        )}
      </div>
    </div>
  );
}
