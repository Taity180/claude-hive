import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setTaskDone, addTaskNote } = vi.hoisted(() => ({
  setTaskDone: vi.fn(),
  addTaskNote: vi.fn(),
}));
vi.mock("../agentApi", () => ({ setTaskDone, addTaskNote }));

import { TaskRow } from "./TaskRow";
import type { Task } from "../types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    externalId: null,
    agentId: null,
    title: "Send Sarah the breakdown",
    appId: "gmail",
    sourceLabel: "Re: Q3 invoicing",
    due: null,
    done: false,
    completedBy: null,
    completedAt: null,
    notes: [],
    createdAt: "2026-08-23T00:00:00Z",
    updatedAt: "2026-08-23T00:00:00Z",
    ...overrides,
  };
}

describe("TaskRow", () => {
  beforeEach(() => {
    setTaskDone.mockReset().mockResolvedValue(true);
    addTaskNote.mockReset().mockResolvedValue(true);
  });

  it("shows the title and where it came from", () => {
    render(<TaskRow task={task()} />);
    expect(screen.getByText("Send Sarah the breakdown")).toBeInTheDocument();
    // Provenance is load-bearing: without it, a task an agent invented looks
    // the same as one out of a real email.
    expect(screen.getByText("Re: Q3 invoicing")).toBeInTheDocument();
  });

  it("ticks the box", async () => {
    render(<TaskRow task={task()} />);
    await userEvent.click(screen.getByTestId("task-checkbox"));
    expect(setTaskDone).toHaveBeenCalledWith("t1", true);
  });

  it("unticks a done task", async () => {
    render(<TaskRow task={task({ done: true, completedBy: { kind: "user" } })} />);
    await userEvent.click(screen.getByTestId("task-checkbox"));
    expect(setTaskDone).toHaveBeenCalledWith("t1", false);
  });

  it("labels an agent completion with the agent's name", () => {
    render(
      <TaskRow
        task={task({
          done: true,
          completedBy: { kind: "agent", id: "a1", name: "Ops Agent" },
        })}
      />
    );
    expect(screen.getByTestId("task-completed-by")).toHaveTextContent("Ops Agent");
  });

  it("does not label the user's own completion as an agent's", () => {
    render(<TaskRow task={task({ done: true, completedBy: { kind: "user" } })} />);
    expect(screen.queryByTestId("task-completed-by")).toBeNull();
  });

  it("counts notes and keeps them collapsed until asked", async () => {
    const notes = [
      {
        id: "n1",
        author: { kind: "user" } as const,
        body: "waiting on the export",
        createdAt: "",
      },
      {
        id: "n2",
        author: { kind: "agent", id: "a1", name: "Ops" } as const,
        body: "export done",
        createdAt: "",
      },
    ];
    render(<TaskRow task={task({ notes })} />);

    const toggle = screen.getByTestId("task-notes-toggle");
    expect(toggle).toHaveTextContent("2");
    expect(screen.queryByText("waiting on the export")).toBeNull();

    await userEvent.click(toggle);
    expect(screen.getByText("waiting on the export")).toBeInTheDocument();
    expect(screen.getByText("export done")).toBeInTheDocument();
  });

  it("attributes each note to its author", async () => {
    const notes = [
      {
        id: "n1",
        author: { kind: "agent", id: "a1", name: "Ops" } as const,
        body: "export done",
        createdAt: "",
      },
    ];
    render(<TaskRow task={task({ notes })} />);
    await userEvent.click(screen.getByTestId("task-notes-toggle"));
    expect(screen.getByText("Ops")).toBeInTheDocument();
  });

  it("offers a way in even with no notes yet", () => {
    // Without this there is no route to the composer at all: the toggle only
    // appeared once a note existed, so the first note could never be written.
    render(<TaskRow task={task()} />);
    expect(screen.getByTestId("task-notes-toggle")).toHaveTextContent(/add note/i);
  });

  it("adds a note and clears the field", async () => {
    render(<TaskRow task={task()} />);
    await userEvent.click(screen.getByTestId("task-notes-toggle"));
    await userEvent.type(screen.getByTestId("task-note-input"), "waiting on the export{Enter}");

    expect(addTaskNote).toHaveBeenCalledWith("t1", "waiting on the export");
    await waitFor(() => expect(screen.getByTestId("task-note-input")).toHaveValue(""));
  });

  it("will not add a blank note", async () => {
    render(<TaskRow task={task()} />);
    await userEvent.click(screen.getByTestId("task-notes-toggle"));
    await userEvent.type(screen.getByTestId("task-note-input"), "   {Enter}");
    expect(addTaskNote).not.toHaveBeenCalled();
  });

  it("keeps the text when adding a note fails", async () => {
    addTaskNote.mockResolvedValue(false);
    render(<TaskRow task={task()} />);
    await userEvent.click(screen.getByTestId("task-notes-toggle"));
    await userEvent.type(screen.getByTestId("task-note-input"), "important{Enter}");
    await waitFor(() => expect(addTaskNote).toHaveBeenCalled());
    expect(screen.getByTestId("task-note-input")).toHaveValue("important");
  });

  it("marks an overdue date so it reads as late", () => {
    render(<TaskRow task={task({ due: "2020-01-01T00:00:00Z" })} />);
    expect(screen.getByTestId("task-due")).toHaveAttribute("data-late", "true");
  });

  it("does not mark a done task as late", () => {
    render(<TaskRow task={task({ due: "2020-01-01T00:00:00Z", done: true })} />);
    expect(screen.getByTestId("task-due")).not.toHaveAttribute("data-late");
  });

  it("shows no date chip at all rather than inventing one", () => {
    // These rows live under a "No date" heading, so repeating it per row is
    // noise — and a fabricated date would be worse than either.
    render(<TaskRow task={task({ due: null })} />);
    expect(screen.queryByTestId("task-due")).toBeNull();
  });

  it("treats an unparseable date as no date", () => {
    render(<TaskRow task={task({ due: "not a date" })} />);
    expect(screen.queryByTestId("task-due")).toBeNull();
  });
});
