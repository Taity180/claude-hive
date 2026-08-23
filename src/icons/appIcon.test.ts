import { describe, expect, it } from "vitest";
import { resolveAppIcon, monogramHue } from "./appIcon";

describe("resolveAppIcon", () => {
  it("returns a real brand mark for a known slug", () => {
    const icon = resolveAppIcon("github");
    expect(icon.kind).toBe("brand");
    if (icon.kind === "brand") {
      expect(icon.hex).toMatch(/^[0-9A-Fa-f]{6}$/);
      expect(icon.path.length).toBeGreaterThan(20);
    }
  });

  it("is case and separator insensitive, because agents choose their own slugs", () => {
    expect(resolveAppIcon("GitHub").kind).toBe("brand");
    expect(resolveAppIcon("git-hub").kind).toBe("brand");
  });

  it("resolves a multi-word catalog name from its slug form", () => {
    // The API sends "google-calendar"; the catalog entry is "Google Calendar".
    expect(resolveAppIcon("google-calendar").kind).toBe("brand");
  });

  it("falls back to a monogram for an unknown slug", () => {
    const icon = resolveAppIcon("totally-made-up-app", "Totally Made Up");
    expect(icon.kind).toBe("monogram");
    if (icon.kind === "monogram") {
      expect(icon.text).toBe("TO");
    }
  });

  it("takes monogram letters from the label when one is given", () => {
    const icon = resolveAppIcon("xy-internal-thing", "Wibble Corp");
    if (icon.kind !== "monogram") throw new Error("expected monogram");
    expect(icon.text).toBe("WI");
  });

  it("never returns an empty monogram", () => {
    const icon = resolveAppIcon("---", "___");
    if (icon.kind !== "monogram") throw new Error("expected monogram");
    expect(icon.text.length).toBeGreaterThan(0);
  });
});

describe("monogramHue", () => {
  it("is stable for the same name", () => {
    // A random palette would reshuffle the apps bar's colours on every launch,
    // which reads as a bug rather than as decoration.
    expect(monogramHue("Semgrep")).toBe(monogramHue("Semgrep"));
  });

  it("is in range and distinguishes different names", () => {
    const a = monogramHue("Semgrep");
    const b = monogramHue("Playwright");
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(360);
    expect(a).not.toBe(b);
  });
});
