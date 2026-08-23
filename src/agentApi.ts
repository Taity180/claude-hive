import { api } from "./api";
import type { Agent, AgentAppRow, AgentPost, AgentQuestion, ConnectionInfo, Task } from "./types";

/**
 * Read a JSON endpoint, falling back rather than throwing.
 *
 * The rail's webview is created at app startup, before the HTTP server is
 * guaranteed to be accepting connections. A rejected fetch must degrade to an
 * empty pane, not an error boundary.
 */
async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${api.baseUrl}${path}`);
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch (err) {
    console.error(`[hive] GET ${path} failed:`, err);
    return fallback;
  }
}

export function fetchAgents(): Promise<Agent[]> {
  return getJson<Agent[]>("/api/agents", []);
}

export function fetchAgentApps(): Promise<AgentAppRow[]> {
  return getJson<AgentAppRow[]>("/api/agents/apps", []);
}

export function fetchAgentPosts(appId?: string, limit = 100): Promise<AgentPost[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (appId) params.set("appId", appId);
  return getJson<AgentPost[]>(`/api/agents/posts?${params}`, []);
}

export function fetchAgentQuestions(): Promise<AgentQuestion[]> {
  return getJson<AgentQuestion[]>("/api/agents/questions", []);
}

/**
 * Record the user's click on an agent's question.
 *
 * Keyed on the question rather than the agent: by the time a click lands the
 * agent may have asked something else.
 */
export async function answerAgentQuestion(
  questionId: string,
  choice: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${api.baseUrl}/api/agents/questions/${questionId}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice }),
      }
    );
    return response.ok;
  } catch (err) {
    console.error("[hive] answering an agent question failed:", err);
    return false;
  }
}

export function fetchConnectionInfo(): Promise<ConnectionInfo | null> {
  return getJson<ConnectionInfo | null>("/api/agents/connection", null);
}

export async function fetchPendingReplies(agentId: string): Promise<number> {
  const result = await getJson<{ pending: number }>(
    `/api/agents/${agentId}/pending`,
    { pending: 0 }
  );
  return result.pending;
}

async function send(path: string, method: string, body: unknown): Promise<boolean> {
  try {
    const response = await fetch(`${api.baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch (err) {
    console.error(`[hive] ${method} ${path} failed:`, err);
    return false;
  }
}

export function replyToAgent(agentId: string, message: string): Promise<boolean> {
  return send(`/api/agents/${agentId}/reply`, "POST", { message });
}

export function setAgentEnabled(agentId: string, enabled: boolean): Promise<boolean> {
  return send(`/api/agents/${agentId}/enabled`, "PUT", { enabled });
}

export function fetchTasks(): Promise<Task[]> {
  return getJson<Task[]>("/api/tasks", []);
}

export function createTask(title: string, due?: string): Promise<boolean> {
  return send("/api/tasks", "POST", { title, due: due ?? null });
}

export function setTaskDone(id: string, done: boolean): Promise<boolean> {
  return send(`/api/tasks/${id}/done`, "PUT", { done });
}

export function addTaskNote(id: string, body: string): Promise<boolean> {
  return send(`/api/tasks/${id}/notes`, "POST", { body });
}

export function deleteTask(id: string): Promise<boolean> {
  return send(`/api/tasks/${id}`, "DELETE", {});
}
