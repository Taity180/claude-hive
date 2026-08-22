import { useState } from "react";
import { setTaskDone } from "../agentApi";
import { AppIcon } from "./AppIcon";
import type { Task } from "../types";

/**
 * A missing or unparseable date reads as "No date", never as today. Inventing
 * a deadline the source never stated would put a false urgency on the list.
 */
function dueLabel(due: string | null): { text: string; late: boolean } {
  if (!due) return { text: "No date", late: false };
  const date = new Date(due);
  if (Number.isNaN(date.getTime())) return { text: "No date", late: false };

  const now = new Date();
  return {
    text:
      date.toDateString() === now.toDateString()
        ? "Today"
        : date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    late: date.getTime() < now.getTime(),
  };
}

export function TaskRow({ task }: { task: Task }) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const due = dueLabel(task.due);
  const isLate = due.late && !task.done;
  const agentCompleted = task.completedBy?.kind === "agent" ? task.completedBy : null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    await setTaskDone(task.id, !task.done);
    setBusy(false);
  };

  return (
    <div
      data-testid="task-row"
      data-done={task.done ? "true" : undefined}
      className="flex gap-2 px-2 py-1.5 rounded-lg"
    >
      <button
        type="button"
        data-testid="task-checkbox"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={() => void toggle()}
        className="shrink-0 grid place-items-center mt-0.5"
        style={{
          width: 15,
          height: 15,
          borderRadius: 4.5,
          border: 0,
          cursor: "pointer",
          background: task.done ? "var(--hub-accent)" : "transparent",
          boxShadow: task.done ? "none" : "inset 0 0 0 1px var(--hub-text-dim)",
        }}
      >
        {task.done && (
          <svg width="9" height="9" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 12l5 5L20 6"
              fill="none"
              stroke="var(--hub-accent-text)"
              strokeWidth="3.4"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className="text-[12.5px] leading-snug"
          style={{
            color: task.done ? "var(--hub-text-dim)" : "var(--hub-text)",
            textDecoration: task.done ? "line-through" : undefined,
          }}
        >
          {task.title}
        </div>

        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {task.appId && (
            <span
              className="inline-flex items-center gap-1 text-[9.5px] rounded px-1.5 py-0.5"
              style={{ background: "var(--hub-surface)", color: "var(--hub-text-muted)" }}
            >
              <AppIcon slug={task.appId} size={10} />
              {task.sourceLabel ?? task.appId}
            </span>
          )}

          <span
            data-testid="task-due"
            data-late={isLate ? "true" : undefined}
            className="text-[9.5px]"
            style={{
              color: isLate ? "#ff7a70" : "var(--hub-text-dim)",
              fontWeight: isLate ? 600 : 400,
            }}
          >
            {due.text}
          </span>

          {/* Attribution, not decoration: an agent quietly ticking the user's
              work off would be a trust problem. */}
          {agentCompleted && (
            <span
              data-testid="task-completed-by"
              className="text-[9.5px] rounded px-1.5 py-0.5"
              style={{ background: "rgba(10,132,255,0.16)", color: "#9ecbff" }}
            >
              Completed by {agentCompleted.name}
            </span>
          )}

          {task.notes.length > 0 && (
            <button
              type="button"
              data-testid="task-notes-toggle"
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((open) => !open)}
              className="text-[9.5px] rounded px-1.5 py-0.5"
              style={{
                background: "var(--hub-surface)",
                border: 0,
                color: "var(--hub-text-muted)",
                cursor: "pointer",
              }}
            >
              {notesOpen ? "▾" : "▸"} {task.notes.length} note
              {task.notes.length === 1 ? "" : "s"}
            </button>
          )}
        </div>

        {notesOpen && (
          <div className="flex flex-col gap-1 mt-1.5">
            {task.notes.map((note) => (
              <div
                key={note.id}
                className="text-[11px] leading-snug rounded px-2 py-1.5"
                style={{
                  background: "rgba(0,0,0,0.22)",
                  boxShadow: "inset 0 0 0 1px var(--hub-hair)",
                  color: "var(--hub-text-muted)",
                }}
              >
                <span
                  className="block text-[9px] font-bold uppercase tracking-wide mb-0.5"
                  style={{
                    color:
                      note.author.kind === "agent" ? "#9ecbff" : "var(--hub-text-dim)",
                  }}
                >
                  {note.author.kind === "agent" ? note.author.name : "You"}
                </span>
                {note.body}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
