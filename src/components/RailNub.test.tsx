import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RailNub } from "./RailNub";
import { useHubStore } from "../stores/hubStore";
import { useRailStore } from "../stores/railStore";
import type { Session } from "../types";

const sessions = [
  { id: "a", projectName: "one", status: "running", lastActivity: "" },
  { id: "b", projectName: "two", status: "waiting_for_input", lastActivity: "" },
  { id: "c", projectName: "three", status: "running", lastActivity: "" },
] as Session[];

function makeTask(overrides: Record<string, unknown>) {
  return {
    id: "t",
    externalId: null,
    agentId: null,
    title: "a",
    appId: null,
    sourceLabel: null,
    due: null,
    done: false,
    completedBy: null,
    completedAt: null,
    notes: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  } as never;
}

describe("RailNub", () => {
  beforeEach(() => {
    useHubStore.setState({ sessions, unreadSessions: new Set(["a", "b"]), agentPosts: [], tasks: [] });
    useRailStore.setState({ restingForm: "nub", openOn: "click", hideWhenIdle: false });
  });

  it("shows one dot per distinct status, not one per session", () => {
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getAllByTestId("status-dot")).toHaveLength(2);
  });

  it("counts unread sessions on the badge", () => {
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("unread-badge")).toHaveTextContent("2");
  });

  it("uses a badge colour outside the status palette", () => {
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("unread-badge")).toHaveStyle({ background: "#ff453a" });
  });

  it("hides the badge when nothing is unread", () => {
    useHubStore.setState({ unreadSessions: new Set() });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.queryByTestId("unread-badge")).toBeNull();
  });

  it("shows a dot rather than a count in sliver form", () => {
    useRailStore.setState({ restingForm: "sliver" });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("unread-badge")).toHaveTextContent("");
  });

  it("names the unread count for screen readers", () => {
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /2 unread/i })).toBeInTheDocument();
  });

  it("opens when clicked", async () => {
    const onOpen = vi.fn();
    render(<RailNub onOpen={onOpen} />);
    await userEvent.click(screen.getByTestId("rail-nub"));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("shows the hive mark when there is nothing else to show", () => {
    // A resting rail with no sessions and no agent activity used to render as a
    // blank black bar, which reads as broken rather than as idle.
    useHubStore.setState({ sessions: [], unreadSessions: new Set(), agentPosts: [], tasks: [] });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("rail-idle-mark")).toBeInTheDocument();
    expect(screen.queryByTestId("status-dot")).toBeNull();
  });

  it("counts unread agent posts on the badge, not just sessions", () => {
    // The nub only knew about Claude sessions, so four unread agent posts left
    // it completely blank.
    useHubStore.setState({
      sessions: [],
      unreadSessions: new Set(),
      tasks: [],
      agentPosts: [
        { id: "p1", agentId: "a", agentName: "Grok", appId: null, content: "x", postType: "info", timestamp: "", read: false },
        { id: "p2", agentId: "a", agentName: "Grok", appId: null, content: "y", postType: "info", timestamp: "", read: false },
      ],
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("unread-badge")).toHaveTextContent("2");
  });

  it("adds unread sessions and unread posts together", () => {
    useHubStore.setState({
      sessions,
      unreadSessions: new Set(["a"]),
      tasks: [],
      agentPosts: [
        { id: "p1", agentId: "a", agentName: "Grok", appId: null, content: "x", postType: "info", timestamp: "", read: false },
      ],
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("unread-badge")).toHaveTextContent("2");
  });

  it("ignores posts already marked read", () => {
    useHubStore.setState({
      sessions: [],
      unreadSessions: new Set(),
      tasks: [],
      agentPosts: [
        { id: "p1", agentId: "a", agentName: "Grok", appId: null, content: "x", postType: "info", timestamp: "", read: true },
      ],
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.queryByTestId("unread-badge")).toBeNull();
  });

  it("shows an agent marker when agents have posted", () => {
    useHubStore.setState({
      sessions: [],
      unreadSessions: new Set(),
      tasks: [],
      agentPosts: [
        { id: "p1", agentId: "a", agentName: "Grok", appId: null, content: "x", postType: "info", timestamp: "", read: true },
      ],
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("agent-marker")).toBeInTheDocument();
  });

  it("shows the open task count on the nub", () => {
    // The spec's third resting variant: two numbers worth showing, unread
    // activity and open tasks, still inside 32px.
    useHubStore.setState({
      sessions: [],
      unreadSessions: new Set(),
      agentPosts: [],
      tasks: [
        { id: "t1", externalId: null, agentId: null, title: "a", appId: null, sourceLabel: null, due: null, done: false, completedBy: null, completedAt: null, notes: [], createdAt: "", updatedAt: "" },
        { id: "t2", externalId: null, agentId: null, title: "b", appId: null, sourceLabel: null, due: null, done: true, completedBy: null, completedAt: null, notes: [], createdAt: "", updatedAt: "" },
      ],
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("nub-task-count")).toHaveTextContent("1");
  });

  it("hides the task count when nothing is open", () => {
    useHubStore.setState({ sessions: [], unreadSessions: new Set(), agentPosts: [], tasks: [] });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.queryByTestId("nub-task-count")).toBeNull();
  });

  it("does not look idle when only tasks are outstanding", () => {
    useHubStore.setState({
      sessions: [],
      unreadSessions: new Set(),
      agentPosts: [],
      tasks: [{ id: "t1", externalId: null, agentId: null, title: "a", appId: null, sourceLabel: null, due: null, done: false, completedBy: null, completedAt: null, notes: [], createdAt: "", updatedAt: "" }],
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.queryByTestId("rail-idle-mark")).toBeNull();
  });

  it("opens on hover when set to hover", async () => {
    useRailStore.setState({ openOn: "hover" });
    const onOpen = vi.fn();
    render(<RailNub onOpen={onOpen} />);
    await userEvent.hover(screen.getByTestId("rail-nub"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("does not open on hover when set to click", async () => {
    // Brushing past the screen edge must not open it.
    useRailStore.setState({ openOn: "click" });
    const onOpen = vi.fn();
    render(<RailNub onOpen={onOpen} />);
    await userEvent.hover(screen.getByTestId("rail-nub"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("fades out while idle if asked to", () => {
    useRailStore.setState({ hideWhenIdle: true });
    useHubStore.setState({ sessions: [], unreadSessions: new Set(), agentPosts: [], tasks: [] });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("rail-nub")).toHaveAttribute("data-dimmed", "true");
  });

  it("still dims with tasks outstanding but nothing due", () => {
    // Keyed on "is there anything here", one undated task kept the rail lit
    // forever and the setting could never be seen to do anything.
    useRailStore.setState({ hideWhenIdle: true });
    useHubStore.setState({
      sessions: [],
      unreadSessions: new Set(),
      agentPosts: [],
      tasks: [makeTask({ id: "t1" })],
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("rail-nub")).toHaveAttribute("data-dimmed", "true");
  });

  it("stays solid for an overdue task", () => {
    useRailStore.setState({ hideWhenIdle: true });
    useHubStore.setState({
      sessions: [],
      unreadSessions: new Set(),
      agentPosts: [],
      tasks: [makeTask({ id: "t1", due: "2020-01-01T00:00:00Z" })],
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("rail-nub")).not.toHaveAttribute("data-dimmed");
  });

  it("stays solid for a session waiting on the user", () => {
    useRailStore.setState({ hideWhenIdle: true });
    useHubStore.setState({
      sessions: [{ id: "s1", status: "waiting_for_input" }] as never,
      unreadSessions: new Set(),
      agentPosts: [],
      tasks: [],
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("rail-nub")).not.toHaveAttribute("data-dimmed");
  });

  it("stays solid for an unread agent post", () => {
    useRailStore.setState({ hideWhenIdle: true });
    useHubStore.setState({
      sessions: [],
      unreadSessions: new Set(),
      agentPosts: [
        {
          id: "p1",
          agentId: "a1",
          agentName: "Grok",
          appId: null,
          content: "hi",
          postType: "info",
          timestamp: "",
          read: false,
        },
      ] as never,
      tasks: [],
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("rail-nub")).not.toHaveAttribute("data-dimmed");
  });

  it("does not dim when hide-when-idle is off", () => {
    useRailStore.setState({ hideWhenIdle: false });
    useHubStore.setState({ sessions: [], unreadSessions: new Set(), agentPosts: [], tasks: [] });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("rail-nub")).not.toHaveAttribute("data-dimmed");
  });

  it("lays its contents out along the edge it rests against", () => {
    // The bug: a top-anchored rail is wide and short, but the nub still
    // stacked its dots vertically, so they overflowed a 32px-tall window.
    useRailStore.setState({ anchor: "top" });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("rail-nub")).toHaveAttribute("data-orientation", "horizontal");
  });

  it("stacks vertically on a side edge", () => {
    useRailStore.setState({ anchor: "right" });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("rail-nub")).toHaveAttribute("data-orientation", "vertical");
  });

  it("treats a corner as vertical", () => {
    useRailStore.setState({ anchor: "br" });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("rail-nub")).toHaveAttribute("data-orientation", "vertical");
  });

  it("counts an unanswered agent question as unread", () => {
    // An agent is blocked on it. A resting rail that showed nothing would hide
    // the one thing with somebody waiting on the other end.
    useHubStore.setState({
      sessions: [],
      unreadSessions: new Set(),
      agentPosts: [],
      tasks: [],
      agentQuestions: [
        {
          id: "q1",
          agentId: "a1",
          agentName: "Grok",
          appId: null,
          question: "Now?",
          options: ["Yes", "No"],
          askedAt: "",
          answer: null,
          answeredAt: null,
        },
      ] as never,
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("unread-badge")).toHaveTextContent("1");
  });

  it("stays solid for a pending question with hide-when-idle on", () => {
    useRailStore.setState({ hideWhenIdle: true });
    useHubStore.setState({
      sessions: [],
      unreadSessions: new Set(),
      agentPosts: [],
      tasks: [],
      agentQuestions: [
        {
          id: "q1",
          agentId: "a1",
          agentName: "Grok",
          appId: null,
          question: "Now?",
          options: ["Yes", "No"],
          askedAt: "",
          answer: null,
          answeredAt: null,
        },
      ] as never,
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("rail-nub")).not.toHaveAttribute("data-dimmed");
  });
});
