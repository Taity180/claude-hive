import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above module scope, so the spy has to be created inside
// vi.hoisted — a plain `const` above the mock is not initialised yet when the
// factory runs.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { RailButton } from "./RailButton";

describe("RailButton", () => {
  it("opens the rail window when pressed", async () => {
    invoke.mockClear();
    invoke.mockResolvedValue(undefined);
    render(<RailButton />);
    await userEvent.click(screen.getByRole("button", { name: /rail/i }));
    expect(invoke).toHaveBeenCalledWith("open_rail");
  });

  it("logs rather than throwing when the window will not open", async () => {
    invoke.mockClear();
    invoke.mockRejectedValue(new Error("no webview"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<RailButton />);
    await userEvent.click(screen.getByRole("button", { name: /rail/i }));
    // Flush the rejection handler.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logged).toHaveBeenCalledWith(
      "[hive] open_rail failed:",
      expect.any(Error)
    );
    logged.mockRestore();
  });
});
