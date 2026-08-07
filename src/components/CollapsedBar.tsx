import { forwardRef } from "react";
import { useHubStore } from "../stores/hubStore";
import { SessionPill } from "./SessionPill";
import { QuestionPrompt } from "./QuestionPrompt";

export const CollapsedBar = forwardRef<HTMLDivElement>(function CollapsedBar(_props, ref) {
  const sessions = useHubStore((s) => s.sessions);
  const setActiveSession = useHubStore((s) => s.setActiveSession);
  const unreadSessions = useHubStore((s) => s.unreadSessions);
  const questions = useHubStore((s) => s.questions);

  const needsAttention = sessions.filter(
    (s) => s.status === "waiting_for_input" || s.status === "error"
  );

  // Sessions blocked on a question get the question itself rather than a
  // count — the whole point of the collapsed bar is answering without
  // expanding the window.
  const asking = sessions
    .map((session) => ({ session, question: questions[session.id] }))
    .filter((entry) => entry.question);

  return (
    <div ref={ref} className="px-3 py-2">
      <div className="flex flex-wrap gap-1.5 items-center">
        {sessions.map((session) => (
          <SessionPill
            key={session.id}
            session={session}
            hasUnread={unreadSessions.has(session.id)}
            onClick={() => setActiveSession(session.id)}
          />
        ))}
        {sessions.length === 0 && (
          <span
            className="text-[11px]"
            style={{ color: "var(--hub-text-muted, #777)" }}
          >
            No sessions connected
          </span>
        )}
      </div>

      {asking.map(({ session, question }) => (
        <div
          key={question!.id}
          className="rounded-md px-2 py-1.5 mt-1.5"
          style={{
            background: "rgba(234, 179, 8, 0.12)",
            border: "1px solid rgba(234, 179, 8, 0.25)",
          }}
        >
          <button
            onClick={() => setActiveSession(session.id)}
            className="text-[10px] font-medium mb-1 hover:underline cursor-pointer"
            style={{ color: "#fbbf24" }}
          >
            {session.customName || session.projectName}
          </button>
          <QuestionPrompt question={question!} variant="compact" />
        </div>
      ))}

      {needsAttention.length > asking.length && (
        <div
          className="flex items-center gap-1 rounded-md px-2 py-1 mt-1.5 w-fit"
          style={{
            background: "rgba(234, 179, 8, 0.15)",
            border: "1px solid rgba(234, 179, 8, 0.2)",
          }}
        >
          <span className="text-[11px] font-medium text-amber-400">
            {needsAttention.length - asking.length} waiting
          </span>
        </div>
      )}
    </div>
  );
});
