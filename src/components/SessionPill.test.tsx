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

  it("tints only a session waiting for input", () => {
    const { container: waiting } = render(
      <SessionPill session={session({ status: "waiting_for_input" })} onClick={vi.fn()} />
    );
    expect(waiting.firstElementChild).toHaveAttribute("data-attention", "true");

    const { container: running } = render(
      <SessionPill session={session({ status: "running" })} onClick={vi.fn()} />
    );
    expect(running.firstElementChild).not.toHaveAttribute("data-attention");
  });

  it("no longer applies the pulsing border animation class", () => {
    const { container } = render(
      <SessionPill session={session({ status: "waiting_for_input" })} onClick={vi.fn()} />
    );
    expect(container.firstElementChild?.className).not.toContain("status-border-pulse");
  });
});
