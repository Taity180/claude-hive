import { useHubStore } from "../stores/hubStore";
import { useRailStore } from "../stores/railStore";
import { resolveAppIcon } from "../icons/appIcon";
import { AppIcon } from "./AppIcon";
import type { AppHealth } from "../types";

/**
 * Health is not a session status, so it gets its own scale rather than
 * borrowing the status palette — otherwise a degraded app would read as a
 * session that needs attention.
 */
const healthColor: Record<AppHealth, string> = {
  ok: "#22c55e",
  degraded: "#eab308",
  down: "#ef4444",
  // Declared last run, nothing heard yet this one. Hollow rather than a colour:
  // any colour here would be a claim about an app nobody has reported on.
  unknown: "transparent",
};

const healthLabel: Record<AppHealth, string> = {
  ok: "connected",
  degraded: "degraded",
  down: "down",
  unknown: "not checked in yet",
};

interface ConnectedAppsBarProps {
  selected: string | null;
  onSelect: (appId: string | null) => void;
}

export function ConnectedAppsBar({ selected, onSelect }: ConnectedAppsBarProps) {
  const apps = useHubStore((s) => s.agentApps);
  const mutedApps = useRailStore((s) => s.mutedApps);
  const toggleAppMuted = useRailStore((s) => s.toggleAppMuted);

  if (apps.length === 0) {
    return (
      <div
        className="px-3 py-2 text-[10.5px] shrink-0"
        style={{
          color: "var(--hub-text-muted)",
          borderBottom: "1px solid var(--hub-hair)",
        }}
      >
        No apps connected
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-2 shrink-0 overflow-x-auto scrollbar-none"
      style={{ borderBottom: "1px solid var(--hub-hair)" }}
    >
      {apps.map((app) => {
        const isSelected = selected === app.id;
        const isMuted = mutedApps.includes(app.id);
        const icon = resolveAppIcon(app.id, app.label);
        return (
          <button
            // Keyed per agent: two agents may both expose Gmail, and collapsing
            // them would lose which agent to reply to.
            key={`${app.agentId}:${app.id}`}
            type="button"
            data-testid="app-node"
            data-app-id={app.id}
            data-selected={isSelected ? "true" : undefined}
            data-health={app.health}
            data-muted={isMuted ? "true" : undefined}
            title={`${app.label} — via ${app.agentName}, ${healthLabel[app.health]}${
              isMuted ? ", muted" : ""
            }. Right-click to ${isMuted ? "unmute" : "mute"}.`}
            aria-pressed={isSelected}
            // Clicking the selected app clears the filter, so the bar is both
            // the way in and the way back out.
            onClick={() => onSelect(isSelected ? null : app.id)}
            // Right-click, because the tiles are 25px and have no room for a
            // per-tile menu button.
            onContextMenu={(e) => {
              e.preventDefault();
              toggleAppMuted(app.id);
            }}
            className="relative shrink-0 grid place-items-center rounded-md"
            style={{
              width: 25,
              height: 25,
              border: 0,
              cursor: "pointer",
              // Selected reads as a tinted tile rather than a solid block: a
              // brand mark on a saturated accent loses its own colour.
              background: isSelected
                ? "color-mix(in srgb, var(--hub-accent) 22%, transparent)"
                : icon.kind === "monogram"
                  ? `hsl(${icon.hue} 45% 22%)`
                  : "var(--hub-surface)",
              boxShadow: isSelected
                ? "inset 0 0 0 1px color-mix(in srgb, var(--hub-accent) 50%, transparent)"
                : "inset 0 0 0 1px var(--hub-hair)",
              // Dimmed rather than removed: a muted app is still connected, and
              // hiding it would leave no way to unmute from here.
              opacity: isMuted ? 0.45 : 1,
            }}
          >
            <AppIcon slug={app.id} label={app.label} />
            {isMuted ? (
              // The badge is the one thing on the tile that reads at a glance,
              // so a muted app says so there rather than only by being dimmer —
              // and its health is not the point while it is muted.
              <span
                data-testid="app-muted-mark"
                aria-hidden="true"
                className="grid place-items-center"
                style={{
                  position: "absolute",
                  right: -3,
                  bottom: -3,
                  width: 11,
                  height: 11,
                  borderRadius: 999,
                  background: "#6b7280",
                  boxShadow: "0 0 0 1.5px var(--hub-bg-solid)",
                }}
              >
                <svg width="8" height="8" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M11 5 6.5 9H3v6h3.5L11 19z"
                    fill="#fff"
                  />
                  <path
                    d="M15.5 9.5l5 5m0-5l-5 5"
                    stroke="#fff"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </span>
            ) : (
              <span
                data-testid="app-health"
                aria-hidden="true"
                style={{
                  position: "absolute",
                  right: -2,
                  bottom: -2,
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: healthColor[app.health],
                  border:
                    app.health === "unknown" ? "1.5px solid #6b7280" : undefined,
                  boxShadow: "0 0 0 1.5px var(--hub-bg-solid)",
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
