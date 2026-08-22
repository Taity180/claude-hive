import { useEffect } from "react";
import { fetchAgentApps, fetchAgentPosts, fetchAgents } from "../agentApi";
import { useHubStore } from "../stores/hubStore";

/**
 * Seed the agent state once on mount.
 *
 * Live updates arrive over the websocket after this; the initial fetch exists
 * because the rail's webview is created at app startup and may connect after an
 * agent has already posted. Deduplication on post id in the store keeps the two
 * sources from doubling a row.
 */
export function useAgentData() {
  const setAgents = useHubStore((s) => s.setAgents);
  const setAgentApps = useHubStore((s) => s.setAgentApps);
  const setAgentPosts = useHubStore((s) => s.setAgentPosts);

  useEffect(() => {
    void (async () => {
      const [agents, apps, posts] = await Promise.all([
        fetchAgents(),
        fetchAgentApps(),
        fetchAgentPosts(),
      ]);
      setAgents(agents);
      setAgentApps(apps);
      setAgentPosts(posts);
    })();
  }, [setAgents, setAgentApps, setAgentPosts]);
}
