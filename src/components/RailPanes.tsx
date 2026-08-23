import { useState } from "react";
import { useHubStore } from "../stores/hubStore";
import { RailPanel } from "./RailPanel";
import { TasksPane } from "./TasksPane";
import { AgentsPane } from "./AgentsPane";
import { RailSettingsPane } from "./RailSettingsPane";
import { ExpandedDashboard } from "./ExpandedDashboard";
import { SessionDetail } from "./SessionDetail";
import { Settings } from "./Settings";
import { ConnectedAppsBar } from "./ConnectedAppsBar";
import { useRailStore } from "../stores/railStore";

type PaneId = "sessions" | "activity" | "tasks" | "agents" | "settings";

interface PaneGroup {
  group: string;
  items: { id: PaneId; label: string; icon: string }[];
}

/** What the rail does. Always present — the sidebar is the rail's own layout. */
const RAIL_GROUP: PaneGroup = {
  group: "Rail",
  items: [
    { id: "activity", label: "All activity", icon: "≡" },
    { id: "tasks", label: "Tasks", icon: "✓" },
    { id: "agents", label: "Agents", icon: "◇" },
    { id: "settings", label: "Settings", icon: "⚙" },
  ],
};

/** What Hive brings, once it has moved in. */
const HIVE_GROUP: PaneGroup = {
  group: "Hive",
  items: [{ id: "sessions", label: "Sessions", icon: "◫" }],
};

/**
 * Hive's own pane, routed the way Hive routes it.
 *
 * The dashboard's session rows and its gear set `viewState` — that is how Hive
 * navigates. Rendering only `ExpandedDashboard` here would leave both as dead
 * clicks: the state changes and nothing on screen follows it. Hive's own title
 * bar carries the back button, so this pane has to supply one.
 */
function HivePane() {
  const viewState = useHubStore((s) => s.viewState);
  const setViewState = useHubStore((s) => s.setViewState);
  const setActiveSession = useHubStore((s) => s.setActiveSession);
  const nested = viewState === "session-detail" || viewState === "settings";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {nested && (
        <div className="shrink-0 px-2 pt-1.5">
          <button
            type="button"
            data-testid="hive-pane-back"
            onClick={() => {
              setActiveSession(null);
              setViewState("expanded");
            }}
            className="text-[10.5px] px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
            style={{
              background: "var(--hub-surface)",
              color: "var(--hub-text-muted)",
              border: 0,
              cursor: "pointer",
            }}
          >
            ← All sessions
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {viewState === "session-detail" ? (
          <SessionDetail />
        ) : viewState === "settings" ? (
          <Settings />
        ) : (
          <ExpandedDashboard />
        )}
      </div>
    </div>
  );
}

/**
 * The rail's panes, behind a sidebar.
 *
 * One layout for both modes. Combined mode moves **Hive into the rail**, not the
 * other way round — the rail is the window that is always there, edge-docked and
 * following the cursor, so it is the one worth having everything in — and all
 * that adds here is the Hive group. Hive's own window steps aside while it is on.
 *
 * These are the same components both windows already use — nothing is
 * reimplemented — and it never creates a window, because
 * `WebviewWindowBuilder::build()` deadlocks once the event loop is running.
 */
export function RailPanes() {
  const combined = useRailStore((s) => s.combined);
  // Hive's group is the only difference between the two modes. The sidebar
  // itself is the rail's layout either way — it was a row of tabs first, and a
  // sidebar reads better at every width the rail is ever given.
  const groups = combined ? [HIVE_GROUP, RAIL_GROUP] : [RAIL_GROUP];
  const [pane, setPane] = useState<PaneId>(combined ? "sessions" : "activity");
  // The connector strip sits above every pane here rather than inside the feed,
  // so the connected apps stay in view whichever pane is showing. Picking one
  // still filters the feed, so the selection has to live above both.
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const sessions = useHubStore((s) => s.sessions);
  const tasks = useHubStore((s) => s.tasks);
  const agents = useHubStore((s) => s.agents);
  const agentPosts = useHubStore((s) => s.agentPosts);

  const counts: Partial<Record<PaneId, number>> = {
    sessions: sessions.filter(
      (s) => s.status === "waiting_for_input" || s.status === "error"
    ).length,
    activity: agentPosts.filter((p) => !p.read).length,
    tasks: tasks.filter((t) => !t.done).length,
    agents: agents.length,
  };

  // Red is for "you need to act", the way the design uses it. Sessions counts
  // only those already waiting or errored, so any is red; tasks turn red on
  // something overdue rather than on merely existing — a badge that is always
  // red stops being read.
  const overdueTasks = tasks.filter(
    (t) => !t.done && t.due !== null && new Date(t.due).getTime() < Date.now()
  ).length;
  const hot: Partial<Record<PaneId, boolean>> = {
    sessions: (counts.sessions ?? 0) > 0,
    tasks: overdueTasks > 0,
  };

  // Detaching removes the Sessions pane; leaving it selected would show a blank
  // content area with no sidebar row to explain it.
  const active: PaneId = !combined && pane === "sessions" ? "activity" : pane;

  const selectApp = (appId: string | null) => {
    setSelectedApp(appId);
    // Filtering by an app is a request to see that app's activity, which is not
    // what the Sessions or Tasks pane shows.
    if (appId) setPane("activity");
  };

  return (
    <div className="flex h-full min-h-0">
      <div
        className="shrink-0 flex flex-col gap-0.5 p-2 overflow-y-auto"
        style={{ width: 150, borderRight: "1px solid var(--hub-hair)" }}
      >
        {groups.map(({ group, items }) => (
          <div key={group} className="flex flex-col gap-0.5">
            <span
              className="text-[9.5px] font-semibold uppercase tracking-wide px-2 pt-1.5 pb-0.5"
              style={{ color: "var(--hub-text-dim)" }}
            >
              {group}
            </span>
            {items.map((item) => {
              const count = counts[item.id] ?? 0;
              const isActive = active === item.id;
              const isHot = hot[item.id] === true && count > 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid="sidebar-item"
                  aria-pressed={isActive}
                  onClick={() => setPane(item.id)}
                  className="flex items-center gap-2 w-full text-left px-2 py-[5px]"
                  style={{
                    border: 0,
                    borderRadius: 7,
                    cursor: "pointer",
                    fontSize: 12.5,
                    fontWeight: isActive ? 600 : 500,
                    background: isActive ? "var(--hub-surface)" : "transparent",
                    color: isActive ? "var(--hub-text)" : "var(--hub-text-muted)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 14,
                      textAlign: "center",
                      // The active pane's mark takes the accent, which is what
                      // carries the selection in the design.
                      color: isActive ? "var(--hub-accent)" : "var(--hub-text-dim)",
                    }}
                  >
                    {item.icon}
                  </span>
                  {item.label}
                  {count > 0 && (
                    <span
                      data-testid={`sidebar-count-${item.id}`}
                      data-hot={isHot ? "true" : undefined}
                      className="ml-auto tabular-nums"
                      style={
                        isHot
                          ? {
                              fontSize: 10,
                              fontWeight: 700,
                              color: "#fff",
                              background: "#ff453a",
                              borderRadius: 999,
                              padding: "0.5px 5px",
                            }
                          : { fontSize: 10, color: "var(--hub-text-dim)" }
                      }
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <ConnectedAppsBar selected={selectedApp} onSelect={selectApp} />

        {active === "sessions" && <HivePane />}
        {active === "activity" && (
          <RailPanel embedded selectedApp={selectedApp} onSelectApp={setSelectedApp} />
        )}
        {active === "tasks" && <TasksPane />}
        {active === "agents" && <AgentsPane />}
        {active === "settings" && <RailSettingsPane />}
      </div>
    </div>
  );
}
