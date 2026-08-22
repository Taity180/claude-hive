import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { RailPanel } from "./RailPanel";
import { useHubStore } from "../stores/hubStore";
import type { Session } from "../types";

const sessions = [
  {
    id: "a",
    projectName: "claude-hive",
    status: "running",
    statusDetail: "Editing mod.rs",
    lastActivity: new Date().toISOString(),
    windowHandle: 42,
  },
  {
    id: "b",
    projectName: "l2u-team-portal",
    status: "waiting_for_input",
    statusDetail: "JWT or cookies?",
    lastActivity: new Date().toISOString(),
  },
] as Session[];

describe("RailPanel", () => {
  beforeEach(() => {
    useHubStore.setState({ sessions, unreadSessions: new Set(), agentPosts: [], agentApps: [] });
  });

  it("lists every session", () => {
    render(<RailPanel />);
    expect(screen.getByText("claude-hive")).toBeInTheDocument();
    expect(screen.getByText("l2u-team-portal")).toBeInTheDocument();
  });

  it("puts a session waiting for input above a running one", () => {
    render(<RailPanel />);
    const rows = screen.getAllByTestId("rail-row");
    expect(rows[0]).toHaveTextContent("l2u-team-portal");
  });

  it("offers go-to-session for a session that has a window handle", () => {
    render(<RailPanel />);
    expect(screen.getAllByTitle("Go to session desktop")).toHaveLength(1);
  });

  it("shows what each session is doing", () => {
    render(<RailPanel />);
    expect(screen.getByText("Editing mod.rs")).toBeInTheDocument();
  });

  it("says so when there is nothing connected", () => {
    useHubStore.setState({ sessions: [] });
    render(<RailPanel />);
    expect(screen.getByText(/no sessions connected/i)).toBeInTheDocument();
  });

  it("interleaves agent posts with sessions in one feed", () => {
    useHubStore.setState({
      sessions,
      agentApps: [],
      agentPosts: [
        {
          id: "p1",
          agentId: "a1",
          agentName: "Grok",
          appId: null,
          content: "Tauri v3 alpha dropped",
          postType: "info",
          timestamp: new Date(Date.now() - 0 * 60000).toISOString(),
          read: false,
        },
      ],
    });
    render(<RailPanel />);
    expect(screen.getByText("Tauri v3 alpha dropped")).toBeInTheDocument();
    expect(screen.getAllByTestId("rail-row")).toHaveLength(3);
  });

  it("tags an agent row as an agent", () => {
    useHubStore.setState({
      sessions: [],
      agentApps: [],
      agentPosts: [
        {
          id: "p1",
          agentId: "a1",
          agentName: "Grok",
          appId: null,
          content: "hello",
          postType: "info",
          timestamp: new Date(Date.now() - 0 * 60000).toISOString(),
          read: false,
        },
      ],
    });
    render(<RailPanel />);
    expect(screen.getByTestId("rail-row")).toHaveAttribute("data-row-kind", "post");
    expect(screen.getByText(/^agent$/i)).toBeInTheDocument();
  });

  it("keeps a blocked session above a newer agent post", () => {
    useHubStore.setState({
      sessions: [
        {
          id: "b",
          projectName: "l2u-team-portal",
          status: "waiting_for_input",
          lastActivity: new Date(Date.now() - 60000).toISOString(),
        } as Session,
      ],
      agentApps: [],
      agentPosts: [
        {
          id: "p1",
          agentId: "a1",
          agentName: "Grok",
          appId: null,
          content: "chatty",
          postType: "info",
          timestamp: new Date(Date.now() - 0 * 60000).toISOString(),
          read: false,
        },
      ],
    });
    render(<RailPanel />);
    expect(screen.getAllByTestId("rail-row")[0]).toHaveAttribute("data-row-kind", "session");
  });

  it("shows the apps bar even with no apps declared", () => {
    render(<RailPanel />);
    expect(screen.getByText(/no apps connected/i)).toBeInTheDocument();
  });
});
