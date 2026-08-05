import { describe, it, expect, beforeEach } from "vitest";
import {
  useHubStore,
  DEFAULT_EXPANDED_HEIGHT,
  MIN_EXPANDED_HEIGHT,
} from "./hubStore";
import type { Session, Message, Question } from "../types";

const mockSession: Session = {
  id: "s1",
  projectName: "my-app",
  customName: null,
  workingDirectory: "/home/user/my-app",
  gitBranch: "main",
  status: "running",
  statusDetail: null,
  connectedAt: "2026-04-12T00:00:00Z",
  lastActivity: "2026-04-12T00:00:00Z",
  windowHandle: null,
};

const mockMessage: Message = {
  id: "m1",
  sessionId: "s1",
  from: "session",
  fromSessionName: null,
  content: "Working on feature",
  messageType: "info",
  timestamp: "2026-04-12T00:00:00Z",
  read: false,
};

describe("hubStore", () => {
  beforeEach(() => {
    useHubStore.setState({
      sessions: [],
      messages: {},
      viewState: "collapsed",
      activeSessionId: null,
      expandedHeight: DEFAULT_EXPANDED_HEIGHT,
    });
  });

  it("handles sessionConnected event", () => {
    useHubStore.getState().handleWsEvent({
      type: "sessionConnected",
      session: mockSession,
    });
    expect(useHubStore.getState().sessions).toHaveLength(1);
    expect(useHubStore.getState().sessions[0].projectName).toBe("my-app");
  });

  it("handles sessionDisconnected event", () => {
    useHubStore.setState({ sessions: [mockSession] });
    useHubStore.getState().handleWsEvent({
      type: "sessionDisconnected",
      sessionId: "s1",
    });
    expect(useHubStore.getState().sessions).toHaveLength(0);
  });

  it("handles statusChanged event", () => {
    useHubStore.setState({ sessions: [mockSession] });
    useHubStore.getState().handleWsEvent({
      type: "statusChanged",
      sessionId: "s1",
      status: "waiting_for_input",
      detail: "Need help",
    });
    expect(useHubStore.getState().sessions[0].status).toBe("waiting_for_input");
    expect(useHubStore.getState().sessions[0].statusDetail).toBe("Need help");
  });

  it("handles newMessage event", () => {
    useHubStore.getState().handleWsEvent({
      type: "newMessage",
      message: mockMessage,
    });
    expect(useHubStore.getState().messages["s1"]).toHaveLength(1);
    expect(useHubStore.getState().messages["s1"][0].content).toBe(
      "Working on feature"
    );
  });

  it("setActiveSession switches to detail view", () => {
    useHubStore.getState().setActiveSession("s1");
    expect(useHubStore.getState().activeSessionId).toBe("s1");
    expect(useHubStore.getState().viewState).toBe("session-detail");
  });

  it("setActiveSession(null) switches to expanded view", () => {
    useHubStore.getState().setActiveSession(null);
    expect(useHubStore.getState().viewState).toBe("expanded");
  });

  it("expandedHeight defaults to DEFAULT_EXPANDED_HEIGHT", () => {
    expect(useHubStore.getState().expandedHeight).toBe(DEFAULT_EXPANDED_HEIGHT);
  });

  it("setExpandedHeight stores the given value", () => {
    useHubStore.getState().setExpandedHeight(640);
    expect(useHubStore.getState().expandedHeight).toBe(640);
  });

  it("setExpandedHeight clamps to MIN_EXPANDED_HEIGHT", () => {
    useHubStore.getState().setExpandedHeight(50);
    expect(useHubStore.getState().expandedHeight).toBe(MIN_EXPANDED_HEIGHT);
  });

  it("setViewState transitions from collapsed to expanded", () => {
    expect(useHubStore.getState().viewState).toBe("collapsed");
    useHubStore.getState().setViewState("expanded");
    expect(useHubStore.getState().viewState).toBe("expanded");
    useHubStore.getState().setViewState("collapsed");
    expect(useHubStore.getState().viewState).toBe("collapsed");
  });
});

const mockQuestion: Question = {
  id: "q1",
  sessionId: "s1",
  question: "JWT or session cookies?",
  options: ["JWT", "Session cookies"],
  multiSelect: false,
  askedAt: "2026-04-12T00:00:00Z",
  answer: null,
  answeredAt: null,
};

describe("hubStore questions", () => {
  beforeEach(() => {
    useHubStore.setState({
      sessions: [mockSession],
      messages: {},
      questions: {},
      unreadSessions: new Set(),
      activeSessionId: null,
      viewState: "collapsed",
    });
  });

  it("questionAsked stores the question against its session", () => {
    useHubStore.getState().handleWsEvent({ type: "questionAsked", question: mockQuestion });

    expect(useHubStore.getState().questions.s1).toEqual(mockQuestion);
  });

  it("questionAsked marks the session unread so the pill flags it", () => {
    useHubStore.getState().handleWsEvent({ type: "questionAsked", question: mockQuestion });

    expect(useHubStore.getState().unreadSessions.has("s1")).toBe(true);
  });

  it("questionAsked does not mark unread while that session is open", () => {
    useHubStore.setState({ activeSessionId: "s1", viewState: "session-detail" });

    useHubStore.getState().handleWsEvent({ type: "questionAsked", question: mockQuestion });

    expect(useHubStore.getState().unreadSessions.has("s1")).toBe(false);
  });

  it("questionAnswered clears the prompt", () => {
    useHubStore.setState({ questions: { s1: mockQuestion } });

    useHubStore.getState().handleWsEvent({
      type: "questionAnswered",
      sessionId: "s1",
      questionId: "q1",
      answer: ["JWT"],
    });

    expect(useHubStore.getState().questions.s1).toBeUndefined();
  });

  it("a late answer for a replaced question leaves the newer prompt alone", () => {
    const newer = { ...mockQuestion, id: "q2" };
    useHubStore.setState({ questions: { s1: newer } });

    useHubStore.getState().handleWsEvent({
      type: "questionAnswered",
      sessionId: "s1",
      questionId: "q1",
      answer: ["JWT"],
    });

    expect(useHubStore.getState().questions.s1).toEqual(newer);
  });

  it("a disconnecting session takes its question with it", () => {
    useHubStore.setState({ questions: { s1: mockQuestion } });

    useHubStore.getState().handleWsEvent({ type: "sessionDisconnected", sessionId: "s1" });

    expect(useHubStore.getState().questions.s1).toBeUndefined();
  });

  it("setPendingQuestions rebuilds the map from a fetched list", () => {
    useHubStore.getState().setPendingQuestions([mockQuestion]);

    expect(useHubStore.getState().questions).toEqual({ s1: mockQuestion });
  });
});
