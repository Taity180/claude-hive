import { describe, expect, it, vi, beforeEach } from "vitest";

describe("currentWindowLabel", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("falls back to main outside Tauri", async () => {
    const { currentWindowLabel } = await import("./windowLabel");
    expect(currentWindowLabel()).toBe("main");
  });

  it("reads the label Tauri reports", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "rail" } },
    };
    const { currentWindowLabel } = await import("./windowLabel");
    expect(currentWindowLabel()).toBe("rail");
  });
});
