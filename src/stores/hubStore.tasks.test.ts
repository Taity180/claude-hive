import { beforeEach, describe, expect, it } from "vitest";
import { useHubStore } from "./hubStore";
import type { Task } from "../types";

function task(id: string, title: string, done = false): Task {
  return {
    id,
    externalId: null,
    agentId: null,
    title,
    appId: null,
    sourceLabel: null,
    due: null,
    done,
    completedBy: null,
    completedAt: null,
    notes: [],
    createdAt: "2026-08-23T00:00:00Z",
    updatedAt: "2026-08-23T00:00:00Z",
  };
}

describe("hubStore tasks", () => {
  beforeEach(() => useHubStore.setState({ tasks: [] }));

  it("adds a task it has not seen", () => {
    useHubStore.getState().handleWsEvent({ type: "taskUpserted", task: task("t1", "One") });
    expect(useHubStore.getState().tasks).toHaveLength(1);
  });

  it("replaces a task in place rather than duplicating it", () => {
    // The store must mirror the server's upsert semantics, or the list shows
    // the same task twice after an agent re-pushes.
    useHubStore.setState({ tasks: [task("t1", "One")] });
    useHubStore.getState().handleWsEvent({
      type: "taskUpserted",
      task: { ...task("t1", "One renamed"), done: true },
    });

    const tasks = useHubStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("One renamed");
    expect(tasks[0].done).toBe(true);
  });

  it("removes a task", () => {
    useHubStore.setState({ tasks: [task("t1", "One"), task("t2", "Two")] });
    useHubStore.getState().handleWsEvent({ type: "taskRemoved", taskId: "t1" });
    expect(useHubStore.getState().tasks.map((t) => t.id)).toEqual(["t2"]);
  });

  it("ignores a removal for something it does not have", () => {
    useHubStore.setState({ tasks: [task("t1", "One")] });
    useHubStore.getState().handleWsEvent({ type: "taskRemoved", taskId: "ghost" });
    expect(useHubStore.getState().tasks).toHaveLength(1);
  });
});
