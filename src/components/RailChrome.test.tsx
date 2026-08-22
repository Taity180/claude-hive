import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { RailChrome } from "./RailChrome";

describe("RailChrome", () => {
  beforeEach(() => invoke.mockClear().mockResolvedValue(undefined));

  it("collapses back to the nub without hiding the window", async () => {
    const onCollapse = vi.fn();
    render(<RailChrome onCollapse={onCollapse} />);
    await userEvent.click(screen.getByRole("button", { name: /collapse/i }));
    expect(onCollapse).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("hides the whole rail window on close", async () => {
    // close_rail existed in Rust from phase 2 and nothing ever called it, so
    // the rail could not be dismissed at all.
    render(<RailChrome onCollapse={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /close the rail/i }));
    expect(invoke).toHaveBeenCalledWith("close_rail");
  });

  it("logs rather than throwing when the window will not close", async () => {
    // invoke rejects; it does not throw synchronously. The component's sync
    // try/catch is belt-and-braces for an unavailable IPC.
    invoke.mockImplementationOnce(() => Promise.reject(new Error("no window")));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<RailChrome onCollapse={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /close the rail/i }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logged).toHaveBeenCalledWith("[hive] close_rail failed:", expect.any(Error));
    logged.mockRestore();
  });
});
