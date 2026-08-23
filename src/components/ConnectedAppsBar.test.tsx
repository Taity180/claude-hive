import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectedAppsBar } from "./ConnectedAppsBar";
import { useHubStore } from "../stores/hubStore";
import { useRailStore } from "../stores/railStore";

const apps = [
  { agentId: "a1", agentName: "Grok", id: "gmail", label: "Gmail", health: "ok" as const },
  { agentId: "a1", agentName: "Grok", id: "x", label: "X", health: "ok" as const },
  {
    agentId: "a2",
    agentName: "Ops",
    id: "made-up-thing",
    label: "Made Up Thing",
    health: "degraded" as const,
  },
];

function nodeFor(appId: string) {
  const node = screen
    .getAllByTestId("app-node")
    .find((n) => n.getAttribute("data-app-id") === appId);
  if (!node) throw new Error(`no app node for ${appId}`);
  return node;
}

describe("ConnectedAppsBar", () => {
  beforeEach(() => {
    localStorage.clear();
    useRailStore.setState(useRailStore.getInitialState(), true);
    useHubStore.setState({ agentApps: apps });
  });

  it("shows one node per connected app", () => {
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    expect(screen.getAllByTestId("app-node")).toHaveLength(3);
  });

  it("marks the selected app", () => {
    render(<ConnectedAppsBar selected="x" onSelect={vi.fn()} />);
    const selected = screen
      .getAllByTestId("app-node")
      .filter((n) => n.getAttribute("data-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute("data-app-id", "x");
  });

  it("selects an app on click", async () => {
    const onSelect = vi.fn();
    render(<ConnectedAppsBar selected={null} onSelect={onSelect} />);
    await userEvent.click(nodeFor("gmail"));
    expect(onSelect).toHaveBeenCalledWith("gmail");
  });

  it("deselects when the already-selected app is clicked again", async () => {
    // The bar is both the way in and the way back out.
    const onSelect = vi.fn();
    render(<ConnectedAppsBar selected="x" onSelect={onSelect} />);
    await userEvent.click(nodeFor("x"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("names the owning agent, so two agents exposing Gmail are distinguishable", () => {
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    expect(nodeFor("made-up-thing").getAttribute("title")).toContain("Ops");
  });

  it("shows health without inventing a new status colour", () => {
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    expect(nodeFor("made-up-thing")).toHaveAttribute("data-health", "degraded");
    expect(nodeFor("gmail")).toHaveAttribute("data-health", "ok");
  });

  it("says so when no agent has declared anything", () => {
    useHubStore.setState({ agentApps: [] });
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/no apps connected/i)).toBeInTheDocument();
  });

  it("keys rows per agent, so the same app from two agents both render", () => {
    useHubStore.setState({
      agentApps: [
        { agentId: "a1", agentName: "Grok", id: "gmail", label: "Gmail", health: "ok" },
        { agentId: "a2", agentName: "Ops", id: "gmail", label: "Gmail", health: "ok" },
      ],
    });
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    expect(screen.getAllByTestId("app-node")).toHaveLength(2);
  });

  it("marks a muted app", () => {
    useRailStore.setState({ mutedApps: ["gmail"] });
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    expect(nodeFor("gmail")).toHaveAttribute("data-muted", "true");
    expect(nodeFor("x")).not.toHaveAttribute("data-muted");
  });

  it("mutes an app from its context menu", () => {
    // Right-click is the way in: the bar is 25px tiles, with no room for a
    // per-tile menu button.
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    fireEvent.contextMenu(nodeFor("gmail"));
    expect(useRailStore.getState().isAppMuted("gmail")).toBe(true);
  });

  it("unmutes on a second right-click", () => {
    useRailStore.setState({ mutedApps: ["gmail"] });
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    fireEvent.contextMenu(nodeFor("gmail"));
    expect(useRailStore.getState().isAppMuted("gmail")).toBe(false);
  });

  it("says in the tooltip that right-click mutes", () => {
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    expect(nodeFor("gmail").getAttribute("title")).toMatch(/right-click/i);
  });
});
