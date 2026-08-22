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
    useHubStore.setState({ sessions, unreadSessions: new Set() });
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
});
