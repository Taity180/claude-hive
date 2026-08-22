import { useMemo, useState } from "react";
import { createTask } from "../agentApi";
import { useHubStore } from "../stores/hubStore";
import { groupTasks, type TaskRange } from "../feed/groupTasks";
import { TaskRow } from "./TaskRow";

const RANGES: { id: TaskRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "all", label: "All" },
];

export function TasksPane() {
  const tasks = useHubStore((s) => s.tasks);
  const [range, setRange] = useState<TaskRange>("all");
  const [draft, setDraft] = useState("");

  const groups = useMemo(() => groupTasks(tasks, range, new Date()), [tasks, range]);
  const openCount = tasks.filter((t) => !t.done).length;

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    const ok = await createTask(title);
    // Only clear on success — losing what they typed to a failed request is
    // worse than making them press enter again.
    if (ok) setDraft("");
  };

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-2 px-2 py-2 shrink-0"
        style={{ borderBottom: "1px solid var(--hub-hair)" }}
      >
        <span
          data-testid="tasks-open-count"
          className="text-[11px] shrink-0"
          style={{ color: "var(--hub-text-muted)" }}
        >
          {openCount} open
        </span>
        <span
          data-testid="tasks-filter"
          className="flex items-center gap-0.5 ml-auto rounded-md p-0.5"
          style={{ background: "rgba(0,0,0,0.24)" }}
        >
          {RANGES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={range === option.id}
              onClick={() => setRange(option.id)}
              className="text-[10.5px] rounded px-1.5 py-0.5"
              style={{
                border: 0,
                cursor: "pointer",
                fontWeight: range === option.id ? 600 : 500,
                background: range === option.id ? "var(--hub-surface)" : "transparent",
                color: range === option.id ? "var(--hub-text)" : "var(--hub-text-muted)",
              }}
            >
              {option.label}
            </button>
          ))}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5">
        {groups.length === 0 && (
          <span className="text-[11px] px-2 py-3" style={{ color: "var(--hub-text-muted)" }}>
            Nothing to do. Agents add tasks here from the apps they are connected to.
          </span>
        )}

        {groups.map((group) => (
          <div key={group.key}>
            <div
              className="text-[9px] font-semibold uppercase tracking-wide px-2 pt-2 pb-0.5"
              style={{ color: "var(--hub-text-dim)" }}
            >
              {group.label}
            </div>
            {group.tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        ))}
      </div>

      <div
        className="shrink-0 flex items-center gap-1.5 px-2 py-2"
        style={{ borderTop: "1px solid var(--hub-hair)" }}
      >
        <span
          aria-hidden="true"
          className="grid place-items-center text-[11px] shrink-0"
          style={{
            width: 15,
            height: 15,
            borderRadius: 4.5,
            boxShadow: "inset 0 0 0 1px var(--hub-text-dim)",
            color: "var(--hub-text-dim)",
          }}
        >
          +
        </span>
        <input
          data-testid="task-add-input"
          value={draft}
          placeholder="Add a task&hellip;"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
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
      </div>
    </div>
  );
}
