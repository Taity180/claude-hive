import { useEffect } from "react";
import { useHubStore } from "../stores/hubStore";
import { api } from "../api";

/** How often the dashboard re-reads usage. The server scans every 30s, so
 *  polling faster would only re-fetch the same numbers. */
const POLL_MS = 30_000;

/**
 * Keep token usage fresh.
 *
 * Usage comes from files on disk rather than from anything a session pushes,
 * so there is no event to subscribe to — a poll is the honest mechanism. It is
 * cheap: the server has already done the scanning, and this just reads the
 * result it is holding in memory.
 */
export function useUsage() {
  const setUsage = useHubStore((s) => s.setUsage);
  const setPlanUsage = useHubStore((s) => s.setPlanUsage);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [tokens, plan] = await Promise.all([
          fetch(`${api.baseUrl}/api/usage`),
          fetch(`${api.baseUrl}/api/usage/plan`),
        ]);
        if (tokens.ok && !cancelled) setUsage(await tokens.json());
        if (plan.ok && !cancelled) setPlanUsage(await plan.json());
      } catch {
        // Hive unreachable — keep the last numbers rather than blanking them.
      }
    };

    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [setUsage, setPlanUsage]);
}
