import type { Task } from "../types";

export type TaskRange = "today" | "week" | "month" | "all";

export type TaskGroupKey =
  | "overdue"
  | "today"
  | "week"
  | "month"
  | "later"
  | "nodate"
  | "done";

export interface TaskGroup {
  key: TaskGroupKey;
  label: string;
  tasks: Task[];
}

/** End of the day `date` falls in, in local time. */
function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function endOfMonth(date: Date): Date {
  return endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

/** Null for missing or unparseable — a bad date must not become a real deadline. */
function dueDate(task: Task): Date | null {
  if (!task.due) return null;
  const parsed = new Date(task.due);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const LABELS: Record<TaskGroupKey, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  month: "This month",
  later: "Later",
  nodate: "No date",
  done: "Done",
};

const ORDER: TaskGroupKey[] = [
  "overdue",
  "today",
  "week",
  "month",
  "later",
  "nodate",
  "done",
];

/** Which dated horizons each filter admits. */
const HORIZONS: Record<TaskRange, TaskGroupKey[]> = {
  today: ["today"],
  week: ["today", "week"],
  month: ["today", "week", "month"],
  all: ["today", "week", "month", "later"],
};

/**
 * Group tasks for display, filtered by how far ahead the user is looking.
 *
 * `now` is injected so the tests are not time-dependent.
 *
 * Two groups ignore the filter entirely: **overdue**, because something already
 * late does not become irrelevant when you narrow the view, and **no date**,
 * because a task with no deadline would otherwise be hidden by every filter and
 * lost. Done sits on its own, out of the dated groups.
 */
export function groupTasks(tasks: Task[], range: TaskRange, now: Date): TaskGroup[] {
  const todayEnd = endOfDay(now);
  const weekEnd = endOfDay(addDays(now, 7));
  const monthEnd = endOfMonth(now);

  const buckets: Record<TaskGroupKey, Task[]> = {
    overdue: [],
    today: [],
    week: [],
    month: [],
    later: [],
    nodate: [],
    done: [],
  };

  for (const task of tasks) {
    if (task.done) {
      buckets.done.push(task);
      continue;
    }
    const due = dueDate(task);
    if (!due) {
      buckets.nodate.push(task);
    } else if (due < now) {
      buckets.overdue.push(task);
    } else if (due <= todayEnd) {
      buckets.today.push(task);
    } else if (due <= weekEnd) {
      buckets.week.push(task);
    } else if (due <= monthEnd) {
      buckets.month.push(task);
    } else {
      buckets.later.push(task);
    }
  }

  const bySoonest = (a: Task, b: Task) => (a.due ?? "").localeCompare(b.due ?? "");
  for (const key of ORDER) {
    buckets[key].sort(bySoonest);
  }

  const allowed = new Set<TaskGroupKey>([
    "overdue",
    ...HORIZONS[range],
    "nodate",
    "done",
  ]);

  return ORDER.filter((key) => allowed.has(key) && buckets[key].length > 0).map((key) => ({
    key,
    label: LABELS[key],
    tasks: buckets[key],
  }));
}
