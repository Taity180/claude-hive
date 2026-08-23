import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ExpandedDashboard } from "./ExpandedDashboard";
import { useHubStore } from "../stores/hubStore";
import type { Session } from "../types";

const sessions = [
  { id: "a", projectName: "claude-hive", status: "error", lastActivity: new Date().toISOString() },
  { id: "b", projectName: "hourglass-v2", status: "waiting_for_input", lastActivity: new Date().toISOString() },
  { id: "c", projectName: "L2U.Services.Orders", status: "running", lastActivity: new Date().toISOString() },
] as Session[];

describe("ExpandedDashboard list rows", () => {
  beforeEach(() => {
    // View mode is component-local state seeded from localStorage under
    // "claude-hive-view-mode" (see ExpandedDashboard.tsx), not store state —
    // so it has to be set here, before the component mounts.
    localStorage.setItem("claude-hive-view-mode", "list");
    useHubStore.setState({ sessions });
  });

  it("does not ring rows in their status colour", () => {
    const { container } = render(<ExpandedDashboard />);
    const rows = container.querySelectorAll("[data-session-row]");
    expect(rows.length).toBe(3);
    rows.forEach((row) => {
      expect((row as HTMLElement).style.border).toContain("var(--hub-hair");
      expect((row as HTMLElement).style.border).not.toContain("#ef4444");
    });
  });

  it("tints the rows that need the user, and only those", () => {
    render(<ExpandedDashboard />);
    // waiting_for_input and error both need the user; running does not.
    expect(screen.getByText("hourglass-v2").closest("[data-session-row]"))
      .toHaveAttribute("data-attention", "true");
    expect(screen.getByText("claude-hive").closest("[data-session-row]"))
      .toHaveAttribute("data-attention", "true");
    expect(screen.getByText("L2U.Services.Orders").closest("[data-session-row]"))
      .not.toHaveAttribute("data-attention");
  });
});
