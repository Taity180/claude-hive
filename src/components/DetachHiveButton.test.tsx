import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { DetachHiveButton } from "./DetachHiveButton";
import { useRailStore } from "../stores/railStore";

describe("DetachHiveButton", () => {
  beforeEach(() => {
    localStorage.clear();
    invoke.mockClear().mockResolvedValue(undefined);
    useRailStore.setState(useRailStore.getInitialState(), true);
  });

  it("turns combined mode off and brings Hive's window back", async () => {
    useRailStore.getState().setCombined(true);
    render(<DetachHiveButton />);
    await userEvent.click(screen.getByTestId("detach-hive"));

    expect(useRailStore.getState().combined).toBe(false);
    // Hive's window hid itself; the rail holds no handle to it, so unhiding
    // has to go through the app handle in Rust.
    expect(invoke).toHaveBeenCalledWith("show_main_window");
  });

  it("still leaves combined mode when the window will not come back", async () => {
    invoke.mockRejectedValue(new Error("gone"));
    render(<DetachHiveButton />);
    await userEvent.click(screen.getByTestId("detach-hive"));
    expect(useRailStore.getState().combined).toBe(false);
  });
});
