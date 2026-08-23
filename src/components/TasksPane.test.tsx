import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTask, setTaskDone } = vi.hoisted(() => ({
  createTask: vi.fn(),
  setTaskDone: vi.fn(),
}));
vi.mock("../agentApi", () => ({ createTask, setTaskDone }));

import { TasksPane } from "./TasksPane";
import { useHubStore } from "../stores/hubStore";
import type { Task } from "../types";

function task(id: string, due: string | null, done = false): Task {
  return {
    id,
    externalId: null,
    agentId: null,
    title: id,
    appId: null,
    sourceLabel: null,
    due,
    done,
    completedBy: null,
    completedAt: null,
    notes: [],
    createdAt: "",
    updatedAt: "",
  };
}

describe("TasksPane", () => {
  beforeEach(() => {
    createTask.mockReset().mockResolvedValue(true);
    setTaskDone.mockReset().mockResolvedValue(true);
    useHubStore.setState({
      tasks: [
        task("overdue-one", "2020-01-01T00:00:00Z"),
        task("undated", null),
        task("finished", null, true),
      ],
    });
  });

  it("groups tasks under headings", () => {
    render(<TasksPane />);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("No date")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("counts only open tasks", () => {
    render(<TasksPane />);
    expect(screen.getByTestId("tasks-open-count")).toHaveTextContent("2");
  });

  it("keeps undated and overdue visible under the Today filter", async () => {
    render(<TasksPane />);
    await userEvent.click(screen.getByRole("button", { name: /^today$/i }));
    expect(screen.getByText("No date")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("adds a task and clears the field", async () => {
    render(<TasksPane />);
    await userEvent.type(screen.getByTestId("task-add-input"), "Buy milk{Enter}");
    expect(createTask).toHaveBeenCalledWith("Buy milk");
    await waitFor(() => expect(screen.getByTestId("task-add-input")).toHaveValue(""));
  });

  it("will not add a blank task", async () => {
    render(<TasksPane />);
    await userEvent.type(screen.getByTestId("task-add-input"), "   {Enter}");
    expect(createTask).not.toHaveBeenCalled();
  });

  it("keeps the text when adding fails", async () => {
    createTask.mockResolvedValue(false);
    render(<TasksPane />);
    await userEvent.type(screen.getByTestId("task-add-input"), "Important{Enter}");
    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(screen.getByTestId("task-add-input")).toHaveValue("Important");
  });

  it("says so when there is nothing to do", () => {
    useHubStore.setState({ tasks: [] });
    render(<TasksPane />);
    expect(screen.getByText(/nothing to do/i)).toBeInTheDocument();
  });
});
