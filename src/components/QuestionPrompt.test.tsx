import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QuestionPrompt } from "./QuestionPrompt";
import { useHubStore } from "../stores/hubStore";
import type { Question } from "../types";

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "q1",
    sessionId: "s1",
    question: "JWT or session cookies?",
    options: ["JWT", "Session cookies"],
    multiSelect: false,
    askedAt: "2026-01-01T00:00:00Z",
    answer: null,
    answeredAt: null,
    ...overrides,
  };
}

function stubFetch(response: { ok?: boolean; text?: () => Promise<string> } = {}) {
  // Declare the parameters so `mock.calls` is typed and assertions on the URL
  // and body typecheck under `tsc --noEmit`.
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    text: async () => "",
    json: async () => ({}),
    ...response,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function answerBody(fetchMock: ReturnType<typeof stubFetch>) {
  return JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
}

beforeEach(() => {
  useHubStore.setState({ questions: { s1: question() } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QuestionPrompt", () => {
  it("shows the question and every option", () => {
    render(<QuestionPrompt question={question()} />);

    expect(screen.getByText("JWT or session cookies?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JWT" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Session cookies" })).toBeInTheDocument();
  });

  it("sends the choice immediately for a single-select question", async () => {
    const fetchMock = stubFetch();
    render(<QuestionPrompt question={question()} />);

    fireEvent.click(screen.getByRole("button", { name: "JWT" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toContain("/api/sessions/s1/ask/answer");
    expect(answerBody(fetchMock)).toEqual({ questionId: "q1", answer: ["JWT"] });
  });

  it("clears the prompt from the store once answered", async () => {
    stubFetch();
    render(<QuestionPrompt question={question()} />);

    fireEvent.click(screen.getByRole("button", { name: "JWT" }));

    await waitFor(() => expect(useHubStore.getState().questions.s1).toBeUndefined());
  });

  it("has no send button when only one option may be chosen", () => {
    render(<QuestionPrompt question={question()} />);
    expect(screen.queryByRole("button", { name: /^Send/ })).not.toBeInTheDocument();
  });

  describe("multi-select", () => {
    const multi = () =>
      question({
        multiSelect: true,
        options: ["Reply box", "Broadcast", "Hotkey"],
      });

    it("accumulates choices instead of sending on each click", () => {
      const fetchMock = stubFetch();
      render(<QuestionPrompt question={multi()} />);

      fireEvent.click(screen.getByRole("button", { name: "Reply box" }));
      fireEvent.click(screen.getByRole("button", { name: "Hotkey" }));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Reply box" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "Broadcast" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("sends every selected option together", async () => {
      const fetchMock = stubFetch();
      render(<QuestionPrompt question={multi()} />);

      fireEvent.click(screen.getByRole("button", { name: "Reply box" }));
      fireEvent.click(screen.getByRole("button", { name: "Hotkey" }));
      fireEvent.click(screen.getByRole("button", { name: "Send (2)" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(answerBody(fetchMock).answer).toEqual(["Reply box", "Hotkey"]);
    });

    it("deselects an option that is clicked twice", () => {
      render(<QuestionPrompt question={multi()} />);

      fireEvent.click(screen.getByRole("button", { name: "Reply box" }));
      fireEvent.click(screen.getByRole("button", { name: "Reply box" }));

      expect(screen.getByRole("button", { name: "Reply box" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("cannot send an empty answer", () => {
      const fetchMock = stubFetch();
      render(<QuestionPrompt question={multi()} />);

      const send = screen.getByRole("button", { name: "Send" });
      expect(send).toBeDisabled();
      fireEvent.click(send);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("surfaces the hub's reason when the answer is rejected", async () => {
    stubFetch({
      ok: false,
      text: async () => "that question has been replaced by a newer one",
    });
    render(<QuestionPrompt question={question()} />);

    fireEvent.click(screen.getByRole("button", { name: "JWT" }));

    expect(
      await screen.findByText("that question has been replaced by a newer one"),
    ).toBeInTheDocument();
    // The prompt stays put so the user isn't left wondering what happened.
    expect(useHubStore.getState().questions.s1).toBeDefined();
  });
});
