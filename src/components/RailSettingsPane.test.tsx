import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { RailSettingsPane } from "./RailSettingsPane";
import { useRailStore } from "../stores/railStore";
import { useHubStore } from "../stores/hubStore";

describe("RailSettingsPane", () => {
  beforeEach(() => {
    localStorage.clear();
    useRailStore.setState(useRailStore.getInitialState(), true);
    useHubStore.setState({ agentApps: [] });
  });

  it("offers all eight anchors", () => {
    render(<RailSettingsPane />);
    expect(screen.getAllByTestId("anchor-option")).toHaveLength(8);
  });

  it("changes the anchor", async () => {
    render(<RailSettingsPane />);
    await userEvent.click(screen.getByRole("button", { name: /bottom left/i }));
    expect(useRailStore.getState().anchor).toBe("bl");
  });

  it("marks the current anchor", () => {
    useRailStore.setState({ anchor: "bl" });
    render(<RailSettingsPane />);
    const pressed = screen
      .getAllByTestId("anchor-option")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAttribute("data-anchor", "bl");
  });

  it("changes the edge offset", async () => {
    render(<RailSettingsPane />);
    await userEvent.click(screen.getByRole("button", { name: /increase edge offset/i }));
    expect(useRailStore.getState().offset).toBe(15);
  });

  it("will not take the offset below zero", async () => {
    useRailStore.setState({ offset: 0 });
    render(<RailSettingsPane />);
    await userEvent.click(screen.getByRole("button", { name: /decrease edge offset/i }));
    expect(useRailStore.getState().offset).toBe(0);
  });

  it("switches the resting form", async () => {
    render(<RailSettingsPane />);
    await userEvent.click(screen.getByRole("button", { name: /^sliver$/i }));
    expect(useRailStore.getState().restingForm).toBe("sliver");
  });

  it("switches open-on", async () => {
    render(<RailSettingsPane />);
    await userEvent.click(screen.getByRole("button", { name: /^hover$/i }));
    expect(useRailStore.getState().openOn).toBe("hover");
  });

  it("toggles follow-cursor, hide-when-idle and combined", async () => {
    render(<RailSettingsPane />);
    await userEvent.click(screen.getByRole("switch", { name: /follow my cursor/i }));
    expect(useRailStore.getState().followCursor).toBe(false);

    await userEvent.click(screen.getByRole("switch", { name: /hide when nothing/i }));
    expect(useRailStore.getState().hideWhenIdle).toBe(true);

    await userEvent.click(screen.getByRole("switch", { name: /bring hive into the rail/i }));
    expect(useRailStore.getState().combined).toBe(true);
  });

  it("shows the remembered size for the current anchor and can forget it", async () => {
    useRailStore.setState({ anchor: "right", sizes: { right: [400, 700] } });
    render(<RailSettingsPane />);
    expect(screen.getByTestId("remembered-size")).toHaveTextContent("400");

    await userEvent.click(screen.getByRole("button", { name: /forget remembered size/i }));
    expect(useRailStore.getState().sizes.right).toBeUndefined();
  });

  it("says when the current anchor has no remembered size", () => {
    useRailStore.setState({ anchor: "right", sizes: {} });
    render(<RailSettingsPane />);
    expect(screen.getByTestId("remembered-size")).toHaveTextContent(/default/i);
  });

  it("lists muted apps and can unmute one", async () => {
    useHubStore.setState({
      agentApps: [
        { agentId: "a1", agentName: "Grok", id: "gmail", label: "Gmail", health: "ok" },
      ],
    });
    useRailStore.setState({ mutedApps: ["gmail"] });
    render(<RailSettingsPane />);

    await userEvent.click(screen.getByRole("button", { name: /unmute gmail/i }));
    expect(useRailStore.getState().isAppMuted("gmail")).toBe(false);
  });

  it("says so when nothing is muted", () => {
    render(<RailSettingsPane />);
    expect(screen.getByText(/nothing muted/i)).toBeInTheDocument();
  });

  it("still lists a muted app the agent has since stopped declaring", () => {
    // Otherwise the mute is unreachable: the app is gone from the bar, so
    // right-clicking it is no longer possible.
    useHubStore.setState({ agentApps: [] });
    useRailStore.setState({ mutedApps: ["ghost"] });
    render(<RailSettingsPane />);
    expect(screen.getByRole("button", { name: /unmute ghost/i })).toBeInTheDocument();
  });
});
