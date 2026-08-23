import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionPill } from "./SessionPill";
import type { Session } from "../types";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    projectName: "claude-hive",
    status: "running",
    lastActivity: new Date().toISOString(),
    ...overrides,
  } as Session;
}

describe("SessionPill", () => {
  it("carries the status colour on the dot, not the border", () => {
    render(<SessionPill session={session({ status: "error" })} onClick={vi.fn()} />);
    const dot = screen.getByTestId("status-dot");
    expect(dot).toHaveStyle({ background: "#ef4444" });
  });

  it("uses a neutral border regardless of status", () => {
    const { container } = render(
      <SessionPill session={session({ status: "error" })} onClick={vi.fn()} />
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.border).toContain("var(--hub-hair");
    expect(wrapper.style.border).not.toContain("#ef4444");
  });

  // "Needs attention" is waiting-or-error throughout the app — the CollapsedBar
  // filter and the tray badge count both use that definition, so the tint has
  // to as well, or a failed build stops standing out.
  it.each(["waiting_for_input", "error"] as const)("tints a %s session", (status) => {
    const { container } = render(
      <SessionPill session={session({ status })} onClick={vi.fn()} />
    );
    expect(container.firstElementChild).toHaveAttribute("data-attention", "true");
  });

  it.each(["running", "thinking", "idle"] as const)("leaves a %s session untinted", (status) => {
    const { container } = render(
      <SessionPill session={session({ status })} onClick={vi.fn()} />
    );
    expect(container.firstElementChild).not.toHaveAttribute("data-attention");
  });

  it("no longer applies the pulsing border animation class", () => {
    const { container } = render(
      <SessionPill session={session({ status: "waiting_for_input" })} onClick={vi.fn()} />
    );
    expect(container.firstElementChild?.className).not.toContain("status-border-pulse");
  });
});
