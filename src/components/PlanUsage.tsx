import { useHubStore } from "../stores/hubStore";
import type { UsageWindow } from "../types";

/** Green while there's room, amber past 75%, red past 90%. */
export function usageColor(pct: number): string {
  if (pct >= 90) return "#ef4444";
  if (pct >= 75) return "#eab308";
  return "#22c55e";
}

/** "2h 14m" until the window rolls over, or null if it already has. */
export function timeUntil(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** Local clock time a window resets at, e.g. "14:20". */
export function resetClock(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * How much of the plan's 5-hour window is spent — the number you actually want
 * before starting something expensive.
 *
 * Sits in the title bar so it's visible in every view. Renders nothing at all
 * unless there's a real percentage to show: an API-key login has no plan
 * window, and a failed fetch should leave no misleading number behind.
 */
export function PlanUsageChip() {
  const plan = useHubStore((s) => s.planUsage);
  const open = useHubStore((s) => s.usagePanelOpen);
  const setOpen = useHubStore((s) => s.setUsagePanelOpen);

  const five = plan?.usage?.fiveHour;
  const pct = five?.utilization;
  if (pct == null) return null;

  const rounded = Math.round(pct);
  const until = timeUntil(five?.resetsAt ?? null);
  const clock = resetClock(five?.resetsAt ?? null);
  // A failed refresh keeps the last good numbers; say so rather than passing
  // them off as current.
  const stale = plan?.status !== "ok";

  return (
    <button
      onClick={() => setOpen(!open)}
      className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-opacity cursor-pointer ${
        stale ? "opacity-25 hover:opacity-50" : "opacity-40 hover:opacity-70"
      }`}
      style={{
        color: "var(--hub-text)",
        background: open ? "var(--hub-surface)" : "transparent",
      }}
      title={
        [
          `5-hour window: ${rounded}% used`,
          clock ? `Resets ${clock}${until ? ` (in ${until})` : ""}` : null,
          stale ? "Last known value — refresh failed" : null,
          "Click for the full breakdown",
        ]
          .filter(Boolean)
          .join("\n")
      }
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: usageColor(rounded) }}
      />
      5h {rounded}%
      {until && <span style={{ opacity: 0.6 }}>· {until}</span>}
    </button>
  );
}

/** One window's row inside the breakdown panel. */
function WindowRow({ label, window }: { label: string; window?: UsageWindow | null }) {
  const pct = window?.utilization;
  if (pct == null) return null;
  const rounded = Math.round(pct);
  const clock = resetClock(window?.resetsAt ?? null);
  const until = timeUntil(window?.resetsAt ?? null);

  return (
    <div className="py-1">
      <div className="flex items-center justify-between text-[10px]">
        <span style={{ color: "var(--hub-text-muted)" }}>{label}</span>
        <span style={{ color: "var(--hub-text)" }}>
          {rounded}%
          {clock && (
            <span style={{ color: "var(--hub-text-muted)" }}>
              {" "}
              · resets {clock}
              {until ? ` (${until})` : ""}
            </span>
          )}
        </span>
      </div>
      <div
        className="h-1 rounded-full overflow-hidden mt-1"
        style={{ background: "var(--hub-surface)" }}
        role="progressbar"
        aria-label={label}
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.max(1, Math.min(100, rounded))}%`, background: usageColor(rounded) }}
        />
      </div>
    </div>
  );
}

/** Every plan window, for the breakdown panel. */
export function PlanUsagePanel() {
  const plan = useHubStore((s) => s.planUsage);
  if (!plan) return null;

  if (plan.status === "notLoggedIn") {
    return (
      <p className="text-[9px]" style={{ color: "var(--hub-text-muted)" }}>
        Plan limits need a Claude Code subscription login. API-key sessions have
        no plan windows.
      </p>
    );
  }

  const usage = plan.usage;
  if (!usage) {
    return (
      <p className="text-[9px]" style={{ color: "var(--hub-text-muted)" }}>
        {plan.status === "expired"
          ? "Login token expired — Claude Code usually refreshes it within a minute."
          : "Plan limits unavailable right now."}
      </p>
    );
  }

  const extra = usage.extraUsage;

  return (
    <>
      <WindowRow label="5-hour" window={usage.fiveHour} />
      <WindowRow label="7-day" window={usage.sevenDay} />
      <WindowRow label="7-day Opus" window={usage.sevenDayOpus} />
      <WindowRow label="7-day Sonnet" window={usage.sevenDaySonnet} />

      {extra?.isEnabled && extra.usedCredits != null && (
        <div className="flex items-center justify-between text-[10px] pt-1">
          <span style={{ color: "var(--hub-text-muted)" }}>Extra credits</span>
          <span style={{ color: "var(--hub-text-muted)" }}>
            {extra.currency === "USD" ? "$" : ""}
            {extra.usedCredits.toFixed(2)}
            {extra.monthlyLimit != null && ` of ${extra.monthlyLimit.toFixed(0)}`}
          </span>
        </div>
      )}

      {plan.status !== "ok" && (
        <p className="text-[9px] mt-1" style={{ color: "var(--hub-text-muted)" }}>
          Last known values — the most recent refresh failed.
        </p>
      )}
    </>
  );
}
