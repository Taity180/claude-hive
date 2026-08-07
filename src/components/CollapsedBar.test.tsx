import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CollapsedBar } from "./CollapsedBar";
import { useHubStore } from "../stores/hubStore";
import type { Question, Session } from "../types";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    projectName: "my-app",
    customName: null,
    workingDirectory: "C:\\repos\\my-app",
    gitBranch: "main",
    status: "running",
    statusDetail: null,
    connectedAt: "2026-01-01T00:00:00Z",
    lastActivity: "2026-01-01T00:00:00Z",
    windowHandle: 1234,
    ...overrides,
  };
}

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CollapsedBar", () => {
  it("forwards ref to the root content element so the window sizer can measure it", () => {
    useHubStore.setState({
      sessions: [],
      messages: {},
      unreadSessions: new Set(),
    });

    const ref = createRef<HTMLDivElement>();
    render(<CollapsedBar ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current?.tagName).toBe("DIV");
  });

  it("renders the empty state when no sessions are connected", () => {
    useHubStore.setState({
      sessions: [],
      messages: {},
      unreadSessions: new Set(),
    });

    const { getByText } = render(<CollapsedBar />);
    expect(getByText("No sessions connected")).toBeInTheDocument();
  });

  describe("renaming a session from the pill", () => {
    function renderWithSession(s: Session = session()) {
      useHubStore.setState({
        sessions: [s],
        messages: {},
        unreadSessions: new Set(),
        activeSessionId: null,
        viewState: "collapsed",
      });
      return render(<CollapsedBar />);
    }

    function stubFetch() {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    /** Click the pencil and return the rename field it opens. */
    function startRename(currentName: string) {
      fireEvent.click(screen.getByRole("button", { name: `Rename ${currentName}` }));
      return screen.getByRole("textbox", { name: `Rename ${currentName}` });
    }

    it("saves the new name and updates the store", async () => {
      const fetchMock = stubFetch();
      renderWithSession();

      const input = startRename("my-app");
      fireEvent.change(input, { target: { value: "billing api" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("/api/sessions/s1/name"),
          expect.objectContaining({
            method: "PUT",
            body: JSON.stringify({ name: "billing api" }),
          }),
        );
      });
      expect(useHubStore.getState().sessions[0].customName).toBe("billing api");
    });

    it("does not open the session while the name is being edited", () => {
      stubFetch();
      renderWithSession();

      fireEvent.click(startRename("my-app"));

      expect(useHubStore.getState().activeSessionId).toBeNull();
      expect(useHubStore.getState().viewState).toBe("collapsed");
    });

    it("discards the edit on Escape", () => {
      const fetchMock = stubFetch();
      renderWithSession();

      const input = startRename("my-app");
      fireEvent.change(input, { target: { value: "nope" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(useHubStore.getState().sessions[0].customName).toBeNull();
      expect(screen.getByText("my-app")).toBeInTheDocument();
    });

    it("clears the custom name when it is reset to the project name", async () => {
      const fetchMock = stubFetch();
      renderWithSession(session({ customName: "billing api" }));

      const input = startRename("billing api");
      fireEvent.change(input, { target: { value: "my-app" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ body: JSON.stringify({ name: "" }) }),
        );
      });
      expect(useHubStore.getState().sessions[0].customName).toBeNull();
    });

    it("keeps the go-to-desktop arrow out of the way while editing", () => {
      stubFetch();
      renderWithSession();
      expect(screen.getByTitle("Go to session desktop")).toBeInTheDocument();

      startRename("my-app");

      expect(screen.queryByTitle("Go to session desktop")).not.toBeInTheDocument();
    });
  });
});

describe("pending questions in the collapsed bar", () => {
  function renderAsking(overrides = {}) {
    useHubStore.setState({
      sessions: [session({ status: "waiting_for_input" })],
      messages: {},
      questions: { s1: question(overrides) },
      unreadSessions: new Set(),
      activeSessionId: null,
      viewState: "collapsed",
    });
    return render(<CollapsedBar />);
  }

  it("shows the question and its options instead of a bare count", () => {
    renderAsking();

    expect(screen.getByText("JWT or session cookies?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JWT" })).toBeInTheDocument();
    expect(screen.queryByText(/waiting$/)).not.toBeInTheDocument();
  });

  it("answers without leaving the collapsed bar", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderAsking();

    fireEvent.click(screen.getByRole("button", { name: "Session cookies" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toContain("/api/sessions/s1/ask/answer");
    expect(useHubStore.getState().viewState).toBe("collapsed");
  });

  it("still counts sessions that are waiting on something other than a question", () => {
    useHubStore.setState({
      sessions: [
        session({ id: "s1", status: "waiting_for_input" }),
        session({ id: "s2", status: "error" }),
      ],
      messages: {},
      questions: { s1: question() },
      unreadSessions: new Set(),
    });
    render(<CollapsedBar />);

    expect(screen.getByText("1 waiting")).toBeInTheDocument();
  });

  it("shows no count when every waiting session has a question on screen", () => {
    renderAsking();
    expect(screen.queryByText(/^\d+ waiting$/)).not.toBeInTheDocument();
  });
});
