import { useEffect } from "react";
import {
  fetchAgentApps,
  fetchAgentPosts,
  fetchAgentQuestions,
  fetchAgents,
  fetchTasks,
} from "../agentApi";
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
  const setAgentQuestions = useHubStore((s) => s.setAgentQuestions);
  const setTasks = useHubStore((s) => s.setTasks);

  useEffect(() => {
    void (async () => {
      const [agents, apps, posts, questions, tasks] = await Promise.all([
        fetchAgents(),
        fetchAgentApps(),
        fetchAgentPosts(),
        fetchAgentQuestions(),
        fetchTasks(),
      ]);
      setAgents(agents);
      setAgentApps(apps);
      setAgentPosts(posts);
      setAgentQuestions(questions);
      setTasks(tasks);
    })();
  }, [setAgents, setAgentApps, setAgentPosts, setAgentQuestions, setTasks]);
}
