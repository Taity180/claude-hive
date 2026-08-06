import { useState } from "react";
import { createPortal } from "react-dom";
import { useHubStore } from "../stores/hubStore";
import type { SessionUsage, TokenUsage } from "../types";

/** "$1.23", or null when the model had no known rates. */
export function formatCost(usd: number | null | undefined): string | null {
  if (usd == null) return null;
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`;
}

/** 1_234_567 → "1.2M", 41_303 → "41.3k". Exact counts don't help at a glance. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

/** Every token, cache included. Dominated by cache reads in practice. */
export function totalTokens(usage: TokenUsage): number {
  return usage.input + usage.output + usage.cacheRead + usage.cacheCreation;
}

/**
 * Input + output only — the headline "tokens used" figure.
 *
 * Cache reads run ~300x the input+output volume on a long session, so a total
 * that includes them says more about how much history is being re-sent each
 * turn than about how much work happened. This is also the basis the 7-day
 * series uses, so the two agree.
 */
export function workTokens(usage: TokenUsage): number {
  return usage.input + usage.output;
}

/** Green until the window is over half full, amber past 75%, red past 90%. */
function contextColor(fraction: number): string {
  if (fraction >= 0.9) return "#ef4444";
  if (fraction >= 0.75) return "#eab308";
  return "#22c55e";
}

/**
 * How full a session's context window is, and what it has cost so far.
 *
 * The percentage only renders for models whose window size we know — an
 * unknown model shows its token count alone rather than a bar measured
 * against a guess.
 */
export function SessionUsageBar({ usage }: { usage: SessionUsage }) {
  const fraction = usage.contextLimit
    ? Math.min(1, usage.contextTokens / usage.contextLimit)
    : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[10px]" style={{ color: "var(--hub-text-muted)" }}>
        <span style={{ color: "var(--hub-text)" }}>
          {formatTokens(usage.contextTokens)} context
        </span>
        {fraction !== null ? (
          <span>
            {Math.round(fraction * 100)}% of {formatTokens(usage.contextLimit!)}
          </span>
        ) : (
          <span title="Unknown model — no context window to measure against">
            window unknown
          </span>
        )}
        <div className="flex-1" />
        <span
          title={`Input + output. ${formatTokens(totalTokens(usage.total))} including cache reads and writes.`}
        >
          {formatTokens(workTokens(usage.total))} total
        </span>
        {formatCost(usage.estimatedCostUsd) && (
          <span title="Estimated at published API rates — not a bill. Subscription plans are not charged per token.">
            ~{formatCost(usage.estimatedCostUsd)}
          </span>
        )}
      </div>

      {fraction !== null && (
        <div
          className="h-1 rounded-full overflow-hidden"
          style={{ background: "var(--hub-surface)" }}
          role="progressbar"
          aria-label="Context window used"
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.max(1, fraction * 100)}%`,
              background: contextColor(fraction),
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Today's token spend across every Claude Code session on the machine, not
 * just the ones connected to the hive — the number you'd want before starting
 * something expensive.
 */
export function GlobalUsage() {
  const usage = useHubStore((s) => s.usage);
  const sessions = useHubStore((s) => s.sessions);
  const [open, setOpen] = useState(false);

  if (!usage || totalTokens(usage.today) === 0) return null;

  const machine = workTokens(usage.today);
  const withCache = totalTokens(usage.today);
  const connected = workTokens(usage.todayConnected);
  const cost = formatCost(usage.todayCostUsd);
  const peak = Math.max(1, ...usage.days.map((d) => d.tokens));

  // Rank today's spenders, naming the ones the hive recognises.
  const spenders = usage.sessions
    .map((u) => ({
      // Same basis as the headline total, so the rows sum to it.
      tokens: workTokens(u.today),
      name: sessions.find((s) => s.claudeSessionId === u.claudeSessionId),
    }))
    .filter((s) => s.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
  const named = spenders.filter((s) => s.name).slice(0, 4);
  const rest = spenders.filter((s) => !named.includes(s));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] opacity-40 hover:opacity-70 transition-opacity px-1.5 py-0.5 rounded"
        style={{
          color: "var(--hub-text)",
          background: open ? "var(--hub-surface)" : "transparent",
        }}
        title="Token usage today — click for the breakdown"
      >
        {formatTokens(machine)} today{cost ? ` · ~${cost}` : ""}
      </button>

      {open &&
        createPortal(
          <div
            style={{
              position: "fixed",
              right: 12,
              top: 72,
              background: "var(--hub-bg-solid, #1a1a1a)",
              border: "1px solid var(--hub-border, #333)",
              width: 260,
              borderRadius: 8,
              padding: 12,
              boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
              zIndex: 99999,
            }}
          >
            <p className="text-[10px] font-medium mb-2" style={{ color: "var(--hub-text)" }}>
              Today — every Claude Code session
            </p>

            <Row label="Input" value={formatTokens(usage.today.input)} />
            <Row label="Output" value={formatTokens(usage.today.output)} />
            <Row label="Total" value={formatTokens(machine)} strong />
            <Row label="Cache read" value={formatTokens(usage.today.cacheRead)} />
            <Row label="Cache write" value={formatTokens(usage.today.cacheCreation)} />
            <Row label="Incl. cache" value={formatTokens(withCache)} />
            <Row label="On the hive" value={formatTokens(connected)} />
            {cost && <Row label="Est. cost" value={`~${cost}`} />}

            <p
              className="text-[10px] font-medium mt-3 mb-1.5"
              style={{ color: "var(--hub-text)" }}
              title="Input + output only. Claude Code's daily history excludes cache traffic, so the cache buckets are left out to keep every day on one basis."
            >
              Last 7 days · input + output
            </p>
            <div className="flex items-end gap-1 h-10">
              {usage.days.map((day) => (
                <div
                  key={day.date}
                  className="flex-1 rounded-t"
                  style={{
                    height: `${Math.max(2, (day.tokens / peak) * 100)}%`,
                    // Prior days come from a cache that lags, so they're dimmed
                    // rather than presented as equally current.
                    background: day.live ? "var(--hub-accent)" : "var(--hub-border)",
                    opacity: day.live ? 1 : 0.7,
                  }}
                  title={`${day.date}: ${day.tokens.toLocaleString()} tokens${day.live ? " (live)" : ""}`}
                />
              ))}
            </div>

            {named.length > 0 && (
              <>
                <p className="text-[10px] font-medium mt-3 mb-1.5" style={{ color: "var(--hub-text)" }}>
                  Top sessions today
                </p>
                {named.map((s) => (
                  <Row
                    key={s.name!.id}
                    label={s.name!.customName || s.name!.projectName}
                    value={formatTokens(s.tokens)}
                  />
                ))}
                {rest.length > 0 && (
                  <Row
                    label={`${rest.length} other session${rest.length === 1 ? "" : "s"}`}
                    value={formatTokens(rest.reduce((sum, s) => sum + s.tokens, 0))}
                  />
                )}
              </>
            )}

            <p className="text-[9px] mt-3" style={{ color: "var(--hub-text-muted)" }}>
              Read from Claude Code transcripts. Cost is estimated at published
              rates, not billed. Plan limits and reset times aren't available.
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-[10px]">
      <span style={{ color: "var(--hub-text-muted)" }}>{label}</span>
      <span
        style={{
          color: strong ? "var(--hub-text)" : "var(--hub-text-muted)",
          fontWeight: strong ? 600 : 400,
        }}
      >
        {value}
      </span>
    </div>
  );
}
