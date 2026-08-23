import { beforeEach, describe, expect, it, vi } from "vitest";

const { emit, listen } = vi.hoisted(() => ({ emit: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit, listen }));

import { broadcastRailSettings, RAIL_SETTINGS_EVENT } from "./railSync";

describe("railSync", () => {
  beforeEach(() => {
    emit.mockReset().mockResolvedValue(undefined);
    listen.mockReset().mockResolvedValue(() => {});
  });

  it("broadcasts a settings change to the other window", async () => {
    // Each webview has its own Zustand instance, so a change in one is
    // invisible to the other without an explicit hop.
    broadcastRailSettings({ combined: true });
    await Promise.resolve();
    expect(emit).toHaveBeenCalledWith(RAIL_SETTINGS_EVENT, { combined: true });
  });

  it("stays quiet outside Tauri, where there is no IPC to fail", async () => {
    // Every render of a rail-aware component would otherwise log, burying real
    // failures under noise in the test output.
    emit.mockRejectedValue(new Error("no ipc"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    broadcastRailSettings({ combined: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("reports a broadcast failure when the IPC is there and still fails", async () => {
    emit.mockRejectedValue(new Error("gone"));
    const internals = "__TAURI_INTERNALS__";
    (window as unknown as Record<string, unknown>)[internals] = {};
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    broadcastRailSettings({ combined: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
    delete (window as unknown as Record<string, unknown>)[internals];
  });
});
