import { useState } from "react";
import { useHubStore } from "../stores/hubStore";
import { RailPanel } from "./RailPanel";
import { TasksPane } from "./TasksPane";
import { AgentsPane } from "./AgentsPane";
import { RailSettingsPane } from "./RailSettingsPane";

type PaneId = "activity" | "tasks" | "agents" | "settings";

const PANES: { id: PaneId; label: string; icon: string }[] = [
  { id: "activity", label: "Activity", icon: "≡" },
  { id: "tasks", label: "Tasks", icon: "✓" },
  { id: "agents", label: "Agents", icon: "◇" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

/**
 * The rail's panes, hosted inside the Hive window.
 *
 * The same components as the rail uses — this reparents them behind a sidebar
 * rather than reimplementing anything. It never creates a window:
 * `WebviewWindowBuilder::build()` deadlocks once the event loop is running, so
 * combined mode only ever hides the rail window that already exists.
 */
export function CombinedPanes() {
  const [pane, setPane] = useState<PaneId>("activity");
  const tasks = useHubStore((s) => s.tasks);
  const agents = useHubStore((s) => s.agents);
  const agentPosts = useHubStore((s) => s.agentPosts);

  const counts: Partial<Record<PaneId, number>> = {
    activity: agentPosts.filter((p) => !p.read).length,
    tasks: tasks.filter((t) => !t.done).length,
    agents: agents.length,
  };

  return (
    <div className="flex h-full min-h-0">
      <div
        className="shrink-0 flex flex-col gap-0.5 p-2"
        style={{ width: 132, borderRight: "1px solid var(--hub-hair)" }}
      >
        {PANES.map((item) => {
          const count = counts[item.id] ?? 0;
          const active = pane === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid="sidebar-item"
              aria-pressed={active}
              onClick={() => setPane(item.id)}
              className="flex items-center gap-2 w-full text-left rounded-md px-2 py-1"
              style={{
                border: 0,
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: active ? 600 : 500,
                background: active ? "var(--hub-surface)" : "transparent",
                color: active ? "var(--hub-text)" : "var(--hub-text-muted)",
              }}
            >
              <span aria-hidden="true" style={{ width: 14, textAlign: "center" }}>
                {item.icon}
              </span>
              {item.label}
              {count > 0 && (
                <span
                  data-testid={`sidebar-count-${item.id}`}
                  className="ml-auto tabular-nums"
                  style={{ fontSize: 10, color: "var(--hub-text-dim)" }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        {pane === "activity" && <RailPanel />}
        {pane === "tasks" && <TasksPane />}
        {pane === "agents" && <AgentsPane />}
        {pane === "settings" && <RailSettingsPane />}
      </div>
    </div>
  );
}
