import { describe, expect, it } from "vitest";
import { paginate, PAGE_SIZE } from "./paginate";

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("paginate", () => {
  it("returns everything on one page when it fits", () => {
    const page = paginate(rows(10), 1);
    expect(page.rows).toHaveLength(10);
    expect(page.pages).toBe(1);
  });

  it("cuts at the page size", () => {
    const page = paginate(rows(120), 1);
    expect(page.rows).toHaveLength(PAGE_SIZE);
    expect(page.rows[0]).toBe(0);
    expect(page.pages).toBe(3);
  });

  it("gives the right slice for a later page", () => {
    const page = paginate(rows(120), 3);
    expect(page.rows[0]).toBe(100);
    expect(page.rows).toHaveLength(20);
  });

  it("clamps a page past the end rather than showing nothing", () => {
    // Rows leave underneath the reader — a muted app, a session disconnecting —
    // so a page number that was valid a moment ago may not be.
    const page = paginate(rows(60), 9);
    expect(page.page).toBe(2);
    expect(page.rows).toHaveLength(10);
  });

  it("clamps a nonsense page", () => {
    expect(paginate(rows(60), 0).page).toBe(1);
    expect(paginate(rows(60), -3).page).toBe(1);
    expect(paginate(rows(60), Number.NaN).page).toBe(1);
  });

  it("reports one page when there is nothing at all", () => {
    // Zero pages would make "1 of 0" and a disabled pager with no explanation.
    const page = paginate([], 1);
    expect(page.pages).toBe(1);
    expect(page.rows).toHaveLength(0);
  });
});
