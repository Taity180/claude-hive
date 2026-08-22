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

describe("RailNub", () => {
  beforeEach(() => {
    useHubStore.setState({ sessions, unreadSessions: new Set(["a", "b"]), agentPosts: [] });
    useRailStore.setState({ restingForm: "nub" });
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
    useHubStore.setState({ sessions: [], unreadSessions: new Set(), agentPosts: [] });
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
      agentPosts: [
        { id: "p1", agentId: "a", agentName: "Grok", appId: null, content: "x", postType: "info", timestamp: "", read: true },
      ],
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("agent-marker")).toBeInTheDocument();
  });
});
