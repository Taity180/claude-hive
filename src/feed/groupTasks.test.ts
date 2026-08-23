import { describe, expect, it } from "vitest";
import { groupTasks } from "./groupTasks";
import type { Task } from "../types";

// Local 9am, and every fixture is derived from it by local-day arithmetic.
// The grouper uses local day boundaries — correct, because the user reads local
// dates — so UTC-literal fixtures would pass or fail depending on the machine's
// timezone.
const NOW = new Date(2026, 7, 23, 9, 0, 0);

const hoursFromNow = (h: number) =>
  new Date(NOW.getTime() + h * 3600_000).toISOString();
const daysFromNow = (d: number) => {
  const date = new Date(NOW);
  date.setDate(date.getDate() + d);
  return date.toISOString();
};

function task(id: string, due: string | null, done = false): Task {
  return {
    id,
    externalId: null,
    agentId: null,
    title: id,
    appId: null,
    sourceLabel: null,
    due,
    done,
    completedBy: null,
    completedAt: null,
    notes: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

const keys = (groups: ReturnType<typeof groupTasks>) => groups.map((g) => g.key);
const idsIn = (groups: ReturnType<typeof groupTasks>, key: string) =>
  groups.find((g) => g.key === key)?.tasks.map((t) => t.id) ?? [];

describe("groupTasks", () => {
  it("separates overdue from today", () => {
    const groups = groupTasks(
      [task("late", daysFromNow(-1)), task("now", hoursFromNow(5))],
      "today",
      NOW
    );
    expect(idsIn(groups, "overdue")).toEqual(["late"]);
    expect(idsIn(groups, "today")).toEqual(["now"]);
  });

  it("always shows undated tasks, whatever the filter", () => {
    // An agent finding "reply to Sarah" has no deadline to read. Hiding it
    // behind a date filter would lose it.
    for (const range of ["today", "week", "month", "all"] as const) {
      const groups = groupTasks([task("undated", null)], range, NOW);
      expect(idsIn(groups, "nodate"), range).toEqual(["undated"]);
    }
  });

  it("always shows overdue, whatever the filter", () => {
    for (const range of ["today", "week", "month", "all"] as const) {
      const groups = groupTasks([task("late", daysFromNow(-20))], range, NOW);
      expect(idsIn(groups, "overdue"), range).toEqual(["late"]);
    }
  });

  it("hides next week's task under the today filter and shows it under week", () => {
    const soon = [task("soon", daysFromNow(3))];
    expect(keys(groupTasks(soon, "today", NOW))).not.toContain("week");
    expect(idsIn(groupTasks(soon, "week", NOW), "week")).toEqual(["soon"]);
  });

  it("puts a task later this month under month, not week", () => {
    const later = [task("later", daysFromNow(8))];
    expect(keys(groupTasks(later, "week", NOW))).not.toContain("month");
    expect(idsIn(groupTasks(later, "month", NOW), "month")).toEqual(["later"]);
  });

  it("shows a task beyond this month only under all", () => {
    const far = [task("far", daysFromNow(45))];
    expect(keys(groupTasks(far, "month", NOW))).not.toContain("later");
    expect(idsIn(groupTasks(far, "all", NOW), "later")).toEqual(["far"]);
  });

  it("keeps done tasks in their own group and out of the dated ones", () => {
    const groups = groupTasks([task("finished", hoursFromNow(2), true)], "today", NOW);
    expect(idsIn(groups, "done")).toEqual(["finished"]);
    expect(idsIn(groups, "today")).toEqual([]);
    expect(idsIn(groups, "overdue")).toEqual([]);
  });

  it("omits empty groups so the pane has no dead headings", () => {
    expect(groupTasks([], "all", NOW)).toEqual([]);
  });

  it("orders dated tasks soonest first", () => {
    const groups = groupTasks(
      [task("b", hoursFromNow(6)), task("a", hoursFromNow(2))],
      "today",
      NOW
    );
    expect(idsIn(groups, "today")).toEqual(["a", "b"]);
  });

  it("tolerates an unparseable due date by treating it as undated", () => {
    const groups = groupTasks([task("broken", "not a date")], "all", NOW);
    expect(idsIn(groups, "nodate")).toEqual(["broken"]);
  });
});
