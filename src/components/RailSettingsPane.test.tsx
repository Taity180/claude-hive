import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const monitors = [
  { index: 0, name: null, width: 2560, height: 1440, x: 0, y: 0, primary: true },
  { index: 1, name: null, width: 1920, height: 1080, x: 2560, y: 0, primary: false },
];
import { RailSettingsPane } from "./RailSettingsPane";
import { useRailStore } from "../stores/railStore";
import { useHubStore } from "../stores/hubStore";

describe("RailSettingsPane", () => {
  beforeEach(() => {
    invoke.mockReset().mockImplementation((cmd: string) =>
      cmd === "list_monitors" ? Promise.resolve(monitors) : Promise.resolve(undefined)
    );
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

  it("lists the screens the rail can be pinned to", async () => {
    render(<RailSettingsPane />);
    await waitFor(() => expect(screen.getByTestId("pinned-monitor")).toBeInTheDocument());
    const picker = screen.getByTestId("pinned-monitor") as HTMLSelectElement;
    await waitFor(() => expect(picker.options.length).toBe(3));
    // Following the cursor is the first option, so it stays the default.
    expect(picker.options[0].value).toBe("");
    expect(picker.options[1].textContent).toMatch(/Screen 1.*primary/);
  });

  it("pins the rail to a screen", async () => {
    render(<RailSettingsPane />);
    await waitFor(() =>
      expect((screen.getByTestId("pinned-monitor") as HTMLSelectElement).options.length).toBe(3)
    );
    await userEvent.selectOptions(screen.getByTestId("pinned-monitor"), "1");
    expect(useRailStore.getState().pinnedMonitor).toBe(1);
  });

  it("goes back to following the cursor", async () => {
    useRailStore.setState({ pinnedMonitor: 1 });
    render(<RailSettingsPane />);
    await waitFor(() =>
      expect((screen.getByTestId("pinned-monitor") as HTMLSelectElement).options.length).toBe(3)
    );
    await userEvent.selectOptions(screen.getByTestId("pinned-monitor"), "");
    expect(useRailStore.getState().pinnedMonitor).toBeNull();
  });

  it("says follow-my-cursor is overridden while pinned", async () => {
    useRailStore.setState({ pinnedMonitor: 0 });
    render(<RailSettingsPane />);
    expect(screen.getByText(/Overridden while the rail is pinned/)).toBeInTheDocument();
  });

  it("survives having no monitor list", async () => {
    // Not under Tauri, or the rail window is not up yet.
    invoke.mockRejectedValue(new Error("no ipc"));
    render(<RailSettingsPane />);
    await waitFor(() =>
      expect((screen.getByTestId("pinned-monitor") as HTMLSelectElement).options.length).toBe(1)
    );
  });
});
