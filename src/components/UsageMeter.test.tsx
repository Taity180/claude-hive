import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionUsageBar, GlobalUsage, formatTokens, formatCost } from "./UsageMeter";
import { useHubStore } from "../stores/hubStore";
import type { SessionUsage, TokenUsage, UsageSnapshot } from "../types";

function tokens(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, ...overrides };
}

function sessionUsage(overrides: Partial<SessionUsage> = {}): SessionUsage {
  return {
    claudeSessionId: "claude-1",
    model: "claude-opus-5",
    contextTokens: 250_000,
    contextLimit: 1_000_000,
    total: tokens({ input: 1_000, output: 2_000, cacheRead: 47_000 }),
    today: tokens({ input: 500, output: 1_000 }),
    estimatedCostUsd: 1.23,
    lastActivity: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function snapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    sessions: [],
    today: tokens(),
    todayConnected: tokens(),
    days: [],
    todayCostUsd: null,
    scannedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("formatTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(41_303)).toBe("41.3k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
  });
});

describe("SessionUsageBar", () => {
  it("shows context used as a share of a known window", () => {
    render(<SessionUsageBar usage={sessionUsage()} />);

    expect(screen.getByText("250.0k context")).toBeInTheDocument();
    expect(screen.getByText("25% of 1.0M")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });

  it("shows the cumulative total alongside the live context size", () => {
    render(<SessionUsageBar usage={sessionUsage()} />);
    expect(screen.getByText("50.0k total")).toBeInTheDocument();
  });

  it("refuses to draw a bar for a model whose window it does not know", () => {
    render(<SessionUsageBar usage={sessionUsage({ contextLimit: null, model: "mystery" })} />);

    expect(screen.getByText("window unknown")).toBeInTheDocument();
    // A percentage against a guessed denominator would be worse than none.
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("clamps a context larger than the window to 100%", () => {
    render(
      <SessionUsageBar
        usage={sessionUsage({ contextTokens: 1_500_000, contextLimit: 1_000_000 })}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("GlobalUsage", () => {
  beforeEach(() => {
    useHubStore.setState({ usage: null });
  });

  it("renders nothing before the first scan lands", () => {
    const { container } = render(<GlobalUsage />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on a day with no usage yet", () => {
    useHubStore.setState({ usage: snapshot() });
    const { container } = render(<GlobalUsage />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reports today's machine-wide total", () => {
    useHubStore.setState({
      usage: snapshot({
        today: tokens({ input: 500_000, output: 100_000 }),
        todayConnected: tokens({ input: 200_000 }),
      }),
    });

    render(<GlobalUsage />);
    expect(screen.getByText("600.0k today")).toBeInTheDocument();
  });

  it("shows the estimated cost alongside the total when available", () => {
    useHubStore.setState({
      usage: snapshot({ today: tokens({ input: 600_000 }), todayCostUsd: 4.5 }),
    });

    render(<GlobalUsage />);
    expect(screen.getByRole("button", { name: /600\.0k today · ~\$4\.50/ })).toBeInTheDocument();
  });

  describe("breakdown popover", () => {
    beforeEach(() => {
      useHubStore.setState({
        sessions: [],
        usage: snapshot({
          today: tokens({ input: 10_000, output: 20_000, cacheRead: 500_000, cacheCreation: 70_000 }),
          todayConnected: tokens({ input: 200_000 }),
          todayCostUsd: 4.5,
          days: [
            { date: "2026-01-05", tokens: 100_000, live: false },
            { date: "2026-01-06", tokens: 600_000, live: true },
          ],
        }),
      });
    });

    it("splits today's usage by bucket once opened", () => {
      render(<GlobalUsage />);
      fireEvent.click(screen.getByRole("button"));

      expect(screen.getByText("Cache read")).toBeInTheDocument();
      expect(screen.getByText("500.0k")).toBeInTheDocument();
      expect(screen.getByText("Cache write")).toBeInTheDocument();
      expect(screen.getByText("70.0k")).toBeInTheDocument();
    });

    it("separates machine-wide from hive-connected usage", () => {
      render(<GlobalUsage />);
      fireEvent.click(screen.getByRole("button"));

      expect(screen.getByText("On the hive")).toBeInTheDocument();
      expect(screen.getByText("200.0k")).toBeInTheDocument();
    });

    it("marks cached history as not live so stale days aren't read as current", () => {
      render(<GlobalUsage />);
      fireEvent.click(screen.getByRole("button"));

      expect(screen.getByTitle(/2026-01-06.*\(live\)/)).toBeInTheDocument();
      const cached = screen.getByTitle(/2026-01-05/);
      expect(cached.getAttribute("title")).not.toContain("live");
    });

    it("names the sessions the hive recognises and aggregates the rest", () => {
      useHubStore.setState({
        sessions: [
          {
            id: "s1",
            projectName: "claude-hive",
            customName: null,
            workingDirectory: "C:\\repos\\claude-hive",
            gitBranch: "main",
            status: "running",
            statusDetail: null,
            connectedAt: "2026-01-01T00:00:00Z",
            lastActivity: "2026-01-01T00:00:00Z",
            windowHandle: null,
            claudeSessionId: "claude-1",
          },
        ],
        usage: snapshot({
          today: tokens({ input: 300_000 }),
          todayCostUsd: null,
          sessions: [
            sessionUsage({ claudeSessionId: "claude-1", today: tokens({ input: 200_000 }) }),
            sessionUsage({ claudeSessionId: "claude-unknown", today: tokens({ input: 100_000 }) }),
          ],
        }),
      });

      render(<GlobalUsage />);
      fireEvent.click(screen.getByRole("button"));

      expect(screen.getByText("claude-hive")).toBeInTheDocument();
      expect(screen.getByText("1 other session")).toBeInTheDocument();
    });

    it("says plainly that plan limits are unavailable", () => {
      render(<GlobalUsage />);
      fireEvent.click(screen.getByRole("button"));

      expect(
        screen.getByText(/Plan limits and reset times aren't available/),
      ).toBeInTheDocument();
    });
  });
});

describe("formatCost", () => {
  it("gives cents under $100 and whole dollars above", () => {
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(1234.5)).toBe("$1235");
  });

  it("returns null for an unpriced model rather than $0", () => {
    expect(formatCost(null)).toBeNull();
    expect(formatCost(undefined)).toBeNull();
  });
});

describe("cost display", () => {
  it("shows an estimated cost when the model has known rates", () => {
    render(<SessionUsageBar usage={sessionUsage()} />);
    expect(screen.getByText("~$1.23")).toBeInTheDocument();
  });

  it("omits cost entirely for an unpriced model", () => {
    render(<SessionUsageBar usage={sessionUsage({ estimatedCostUsd: null })} />);
    expect(screen.queryByText(/^~\$/)).not.toBeInTheDocument();
  });
});
