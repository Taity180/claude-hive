import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useHubStore } from "../stores/hubStore";
import { RailPanel } from "./RailPanel";
import { TasksPane } from "./TasksPane";
import { AgentsPane } from "./AgentsPane";
import { RailSettingsPane } from "./RailSettingsPane";
import { ExpandedDashboard } from "./ExpandedDashboard";
import { useRailStore } from "../stores/railStore";

type PaneId = "sessions" | "activity" | "tasks" | "agents" | "settings";

const PANES: { id: PaneId; label: string; icon: string }[] = [
  { id: "sessions", label: "Sessions", icon: "◫" },
  { id: "activity", label: "Activity", icon: "≡" },
  { id: "tasks", label: "Tasks", icon: "✓" },
  { id: "agents", label: "Agents", icon: "◇" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

/**
 * Everything in one place, behind a sidebar.
 *
 * Combined mode moves **Hive into the rail**, not the other way round: the rail
 * is the window that is always there, edge-docked and following the cursor, so
 * it is the one worth having everything in. Hive's window steps aside while
 * this is showing.
 *
 * These are the same components both windows already use — nothing is
 * reimplemented — and it never creates a window, because
 * `WebviewWindowBuilder::build()` deadlocks once the event loop is running.
 */
export function CombinedPanes() {
  const [pane, setPane] = useState<PaneId>("sessions");
  const sessions = useHubStore((s) => s.sessions);
  const tasks = useHubStore((s) => s.tasks);
  const agents = useHubStore((s) => s.agents);
  const agentPosts = useHubStore((s) => s.agentPosts);
  const setCombined = useRailStore((s) => s.setCombined);

  const counts: Partial<Record<PaneId, number>> = {
    sessions: sessions.filter(
      (s) => s.status === "waiting_for_input" || s.status === "error"
    ).length,
    activity: agentPosts.filter((p) => !p.read).length,
    tasks: tasks.filter((t) => !t.done).length,
    agents: agents.length,
  };

  const detach = () => {
    setCombined(false);
    // Hive's window hid itself when combined mode turned on, and it cannot
    // unhide itself from here — only Rust holds a handle to it.
    void invoke("show_main_window").catch((err) => {
      console.error("[hive] show_main_window failed:", err);
    });
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

        <button
          type="button"
          data-testid="detach-hive"
          onClick={detach}
          className="mt-auto text-[10.5px] rounded-md px-2 py-1 text-left"
          style={{
            background: "var(--hub-surface)",
            border: 0,
            color: "var(--hub-text-muted)",
            cursor: "pointer",
          }}
          title="Give Hive its own window again"
        >
          Detach Hive
        </button>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        {pane === "sessions" && (
          <div className="flex-1 overflow-y-auto">
            <ExpandedDashboard />
          </div>
        )}
        {pane === "activity" && <RailPanel />}
        {pane === "tasks" && <TasksPane />}
        {pane === "agents" && <AgentsPane />}
        {pane === "settings" && <RailSettingsPane />}
      </div>
    </div>
  );
}
