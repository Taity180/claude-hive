import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanUsageChip, PlanUsagePanel, timeUntil, resetClock, usageColor } from "./PlanUsage";
import { useHubStore } from "../stores/hubStore";
import type { PlanUsageSnapshot, PlanUsageStatus } from "../types";

function snapshot(
  status: PlanUsageStatus,
  usage: PlanUsageSnapshot["usage"] = null,
): PlanUsageSnapshot {
  return { status, usage, fetchedAt: "2026-08-07T10:00:00Z" };
}

const FULL: PlanUsageSnapshot["usage"] = {
  fiveHour: { utilization: 42.4, resetsAt: "2026-08-07T14:20:00Z" },
  sevenDay: { utilization: 12, resetsAt: "2026-08-11T00:00:00Z" },
  sevenDayOpus: { utilization: 91, resetsAt: "2026-08-11T00:00:00Z" },
  sevenDaySonnet: null,
  extraUsage: null,
};

beforeEach(() => {
  useHubStore.setState({ planUsage: null });
});

describe("usageColor", () => {
  it("escalates green → amber → red", () => {
    expect(usageColor(10)).toBe("#22c55e");
    expect(usageColor(80)).toBe("#eab308");
    expect(usageColor(95)).toBe("#ef4444");
  });
});

describe("timeUntil", () => {
  const now = new Date("2026-08-07T12:00:00Z").getTime();

  it("renders hours and minutes", () => {
    expect(timeUntil("2026-08-07T14:20:00Z", now)).toBe("2h 20m");
    expect(timeUntil("2026-08-07T12:45:00Z", now)).toBe("45m");
    expect(timeUntil("2026-08-07T15:00:00Z", now)).toBe("3h");
  });

  it("rolls up to days for the weekly window, which is often days out", () => {
    // "128h 9m" is a number you have to do arithmetic on.
    expect(timeUntil("2026-08-12T20:09:00Z", now)).toBe("5d 8h");
    expect(timeUntil("2026-08-09T12:00:00Z", now)).toBe("2d");
    expect(timeUntil("2026-08-08T11:00:00Z", now)).toBe("23h");
  });

  it("returns null once the window has already reset", () => {
    expect(timeUntil("2026-08-07T11:00:00Z", now)).toBeNull();
  });

  it("returns null for a missing or unparseable timestamp", () => {
    expect(timeUntil(null, now)).toBeNull();
    expect(timeUntil("not a date", now)).toBeNull();
  });
});

describe("resetClock", () => {
  it("returns null rather than an Invalid Date string", () => {
    expect(resetClock(null)).toBeNull();
    expect(resetClock("nonsense")).toBeNull();
  });
});

describe("PlanUsageChip", () => {
  it("shows nothing before the first poll", () => {
    const { container } = render(<PlanUsageChip />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing for an API-key login, which has no plan window", () => {
    useHubStore.setState({ planUsage: snapshot("notLoggedIn") });
    const { container } = render(<PlanUsageChip />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the five-hour window rounded", () => {
    useHubStore.setState({ planUsage: snapshot("ok", FULL) });
    render(<PlanUsageChip />);
    expect(screen.getByText(/5h 42%/)).toBeInTheDocument();
  });

  it("names the reset time in its tooltip", () => {
    useHubStore.setState({ planUsage: snapshot("ok", FULL) });
    render(<PlanUsageChip />);
    expect(screen.getByText(/5h 42%/).getAttribute("title")).toMatch(/Resets/);
  });

  it("marks a stale reading rather than passing it off as current", () => {
    useHubStore.setState({ planUsage: snapshot("unavailable", FULL) });
    render(<PlanUsageChip />);
    expect(screen.getByText(/5h 42%/).getAttribute("title")).toMatch(/refresh failed/i);
  });
});

describe("PlanUsagePanel", () => {
  it("lists every window that reported a number", () => {
    useHubStore.setState({ planUsage: snapshot("ok", FULL) });
    render(<PlanUsagePanel />);

    expect(screen.getByRole("progressbar", { name: "5-hour" })).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByRole("progressbar", { name: "7-day" })).toHaveAttribute("aria-valuenow", "12");
    expect(screen.getByRole("progressbar", { name: "7-day Opus" })).toHaveAttribute("aria-valuenow", "91");
    // Sonnet reported null — no row rather than a zeroed bar.
    expect(screen.queryByRole("progressbar", { name: "7-day Sonnet" })).not.toBeInTheDocument();
  });

  it("explains an API-key login instead of showing an empty panel", () => {
    useHubStore.setState({ planUsage: snapshot("notLoggedIn") });
    render(<PlanUsagePanel />);
    expect(screen.getByText(/subscription login/i)).toBeInTheDocument();
  });

  it("explains an expired token and that it self-heals", () => {
    useHubStore.setState({ planUsage: snapshot("expired") });
    render(<PlanUsagePanel />);
    expect(screen.getByText(/token expired/i)).toBeInTheDocument();
  });

  it("flags last-known values when the latest refresh failed", () => {
    useHubStore.setState({ planUsage: snapshot("unavailable", FULL) });
    render(<PlanUsagePanel />);
    expect(screen.getByText(/Last known values/i)).toBeInTheDocument();
  });

  it("shows extra credits only when the account has them enabled", () => {
    useHubStore.setState({
      planUsage: snapshot("ok", {
        ...FULL,
        extraUsage: {
          isEnabled: true,
          monthlyLimit: 50,
          usedCredits: 12.5,
          utilization: 25,
          currency: "USD",
        },
      }),
    });
    render(<PlanUsagePanel />);
    expect(screen.getByText("Extra credits")).toBeInTheDocument();
    expect(screen.getByText(/\$12\.50 of 50/)).toBeInTheDocument();
  });
});
