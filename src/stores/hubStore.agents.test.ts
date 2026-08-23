import { beforeEach, describe, expect, it } from "vitest";
import { useHubStore } from "./hubStore";
import type { Agent, AgentPost, AgentQuestion } from "../types";

function post(id: string, content: string, appId: string | null = null): AgentPost {
  return {
    id,
    agentId: "a1",
    agentName: "Grok",
    appId,
    content,
    postType: "info",
    timestamp: new Date().toISOString(),
    read: false,
  };
}

function question(id: string, overrides: Partial<AgentQuestion> = {}): AgentQuestion {
  return {
    id,
    agentId: "a1",
    agentName: "Grok",
    appId: null,
    question: "Now?",
    options: ["Yes", "No"],
    askedAt: new Date().toISOString(),
    answer: null,
    answeredAt: null,
    ...overrides,
  };
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "Grok",
    version: null,
    connectedAt: "2026-08-23T00:00:00Z",
    lastSeen: "2026-08-23T00:00:00Z",
    enabled: true,
    ...overrides,
  };
}

describe("hubStore agents", () => {
  beforeEach(() => {
    useHubStore.setState({ agents: [], agentApps: [], agentPosts: [], agentQuestions: [] });
  });

  it("adds a connecting agent", () => {
    useHubStore.getState().handleWsEvent({ type: "agentConnected", agent: agent() });
    expect(useHubStore.getState().agents).toHaveLength(1);
  });

  it("updates an agent that reconnects rather than duplicating it", () => {
    const store = useHubStore.getState();
    store.handleWsEvent({ type: "agentConnected", agent: agent() });
    store.handleWsEvent({ type: "agentConnected", agent: agent({ name: "Grok Bot" }) });

    const agents = useHubStore.getState().agents;
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("Grok Bot");
  });

  it("puts a new post at the front", () => {
    useHubStore.setState({ agentPosts: [post("p1", "older")] });
    useHubStore.getState().handleWsEvent({ type: "agentPosted", post: post("p2", "newer") });

    const posts = useHubStore.getState().agentPosts;
    expect(posts[0].content).toBe("newer");
    expect(posts).toHaveLength(2);
  });

  it("ignores a post it already has, so a refetch plus a live event cannot double it", () => {
    useHubStore.setState({ agentPosts: [post("p1", "one")] });
    useHubStore.getState().handleWsEvent({ type: "agentPosted", post: post("p1", "one") });
    expect(useHubStore.getState().agentPosts).toHaveLength(1);
  });

  it("replaces an agent's apps on change, keeping other agents' apps", () => {
    useHubStore.setState({
      agentApps: [
        { agentId: "a1", agentName: "Grok", id: "gmail", label: "Gmail", health: "ok" },
        { agentId: "a2", agentName: "Ops", id: "linear", label: "Linear", health: "ok" },
      ],
    });

    useHubStore.getState().handleWsEvent({
      type: "agentAppsChanged",
      agentId: "a1",
      apps: [{ id: "x", label: "X", health: "ok" }],
    });

    const apps = useHubStore.getState().agentApps;
    // a1's gmail is gone (sync replaces), a2 is untouched.
    expect(apps.filter((a) => a.agentId === "a1").map((a) => a.id)).toEqual(["x"]);
    expect(apps.filter((a) => a.agentId === "a2")).toHaveLength(1);
  });

  it("clears an agent's apps when it reports none", () => {
    useHubStore.setState({
      agentApps: [
        { agentId: "a1", agentName: "Grok", id: "gmail", label: "Gmail", health: "ok" },
      ],
    });
    useHubStore.getState().handleWsEvent({
      type: "agentAppsChanged",
      agentId: "a1",
      apps: [],
    });
    expect(useHubStore.getState().agentApps).toHaveLength(0);
  });

  it("keeps the agent name on rows it rebuilds from an apps event", () => {
    useHubStore.setState({ agents: [agent()], agentApps: [] });
    useHubStore.getState().handleWsEvent({
      type: "agentAppsChanged",
      agentId: "a1",
      apps: [{ id: "x", label: "X", health: "ok" }],
    });
    expect(useHubStore.getState().agentApps[0].agentName).toBe("Grok");
  });

  it("does not crash on an apps event for an agent it has never seen", () => {
    useHubStore.getState().handleWsEvent({
      type: "agentAppsChanged",
      agentId: "ghost",
      apps: [{ id: "x", label: "X", health: "ok" }],
    });
    expect(useHubStore.getState().agentApps[0].agentName).toBeTruthy();
  });

  it("shows a question an agent asked", () => {
    useHubStore.getState().handleWsEvent({ type: "agentAsked", question: question("q1") });
    expect(useHubStore.getState().agentQuestions).toHaveLength(1);
  });

  it("replaces an agent's previous question rather than stacking them", () => {
    // One question per agent, as for sessions: a second means the agent moved
    // on, and answering the first would answer something abandoned.
    const store = useHubStore.getState();
    store.handleWsEvent({ type: "agentAsked", question: question("q1") });
    store.handleWsEvent({ type: "agentAsked", question: question("q2") });

    const questions = useHubStore.getState().agentQuestions;
    expect(questions).toHaveLength(1);
    expect(questions[0].id).toBe("q2");
  });

  it("keeps questions from different agents side by side", () => {
    const store = useHubStore.getState();
    store.handleWsEvent({ type: "agentAsked", question: question("q1") });
    store.handleWsEvent({
      type: "agentAsked",
      question: question("q2", { agentId: "a2", agentName: "Ops" }),
    });
    expect(useHubStore.getState().agentQuestions).toHaveLength(2);
  });

  it("drops a question answered in the other window", () => {
    // Both windows render the same question; a click in one must not leave dead
    // buttons in the other.
    const store = useHubStore.getState();
    store.handleWsEvent({ type: "agentAsked", question: question("q1") });
    store.handleWsEvent({
      type: "agentQuestionAnswered",
      question: question("q1", { answer: "Yes", answeredAt: new Date().toISOString() }),
    });
    expect(useHubStore.getState().agentQuestions).toHaveLength(0);
  });
});
