import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { answerAgentQuestion } = vi.hoisted(() => ({ answerAgentQuestion: vi.fn() }));
vi.mock("../agentApi", () => ({ answerAgentQuestion }));

import { AgentQuestionRow } from "./AgentQuestionRow";
import { useHubStore } from "../stores/hubStore";
import type { AgentQuestion } from "../types";

const question: AgentQuestion = {
  id: "q1",
  agentId: "a1",
  agentName: "Grok Bot",
  appId: "gmail",
  question: "Reply to Sarah now?",
  options: ["Yes", "Later"],
  askedAt: "2026-08-23T12:00:00Z",
  answer: null,
  answeredAt: null,
};

describe("AgentQuestionRow", () => {
  beforeEach(() => {
    answerAgentQuestion.mockReset().mockResolvedValue(true);
    useHubStore.setState({ agentQuestions: [question] });
  });

  it("shows the question, who asked it, and one button per option", () => {
    render(<AgentQuestionRow question={question} />);
    expect(screen.getByText("Reply to Sarah now?")).toBeInTheDocument();
    expect(screen.getByText("Grok Bot")).toBeInTheDocument();
    expect(screen.getAllByTestId("question-option")).toHaveLength(2);
  });

  it("sends the clicked option and drops the row", async () => {
    render(<AgentQuestionRow question={question} />);
    await userEvent.click(screen.getByRole("button", { name: "Later" }));

    expect(answerAgentQuestion).toHaveBeenCalledWith("q1", "Later");
    // Dropped locally rather than waiting for the websocket: the click should
    // feel done immediately.
    await waitFor(() => expect(useHubStore.getState().agentQuestions).toHaveLength(0));
  });

  it("keeps the buttons live when sending fails", async () => {
    // An unanswerable question would strand the agent, which is waiting on it.
    answerAgentQuestion.mockResolvedValue(false);
    render(<AgentQuestionRow question={question} />);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(screen.getByText(/Could not send/)).toBeInTheDocument());
    const buttons = screen.getAllByTestId("question-option");
    expect(buttons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect(useHubStore.getState().agentQuestions).toHaveLength(1);
  });

  it("cannot be answered twice by double-clicking", async () => {
    let release: (ok: boolean) => void = () => {};
    answerAgentQuestion.mockReturnValue(new Promise<boolean>((r) => (release = r)));

    render(<AgentQuestionRow question={question} />);
    const yes = screen.getByRole("button", { name: "Yes" });
    await userEvent.click(yes);
    await userEvent.click(screen.getByRole("button", { name: "Later" }));

    expect(answerAgentQuestion).toHaveBeenCalledTimes(1);
    release(true);
  });

  it("reads as needing the user, like a blocked session", () => {
    render(<AgentQuestionRow question={question} />);
    const row = screen.getByTestId("rail-row");
    expect(row).toHaveAttribute("data-row-kind", "question");
    expect(row.style.background).toContain("--hub-attention");
  });
});
