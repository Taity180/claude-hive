import { describe, expect, it } from "vitest";
import { themes, getThemeById, defaultTheme, glass } from "./index";

describe("themes", () => {
  it("still offers all ten", () => {
    expect(themes).toHaveLength(10);
  });

  it("varies only the accent and the attention tint", () => {
    // A theme used to redefine every surface, so choosing a colour changed the
    // app's character and the glass look was ten different looks.
    for (const theme of themes) {
      expect(theme.accent, `${theme.id} accent`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.accentText, `${theme.id} accentText`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.attention, `${theme.id} attention`).toMatch(/^rgba?\(/);
      expect(Object.keys(theme).sort()).toEqual([
        "accent",
        "accentText",
        "attention",
        "id",
        "name",
      ]);
    }
  });

  it("keeps the accents distinct, so the picker means something", () => {
    const accents = new Set(themes.map((t) => t.accent));
    expect(accents.size).toBe(themes.length);
  });

  it("resolves an unknown id to the default", () => {
    expect(defaultTheme.id).toBe("frosted-glass");
    expect(getThemeById("nope")).toBe(defaultTheme);
    expect(getThemeById(null)).toBe(defaultTheme);
  });
});

describe("the glass palette", () => {
  it("is translucent where it sits over other content, and solid where it grounds a window", () => {
    // bgSolid is opaque on purpose: the rail's opacity setting decides how much
    // desktop shows through, and multiplying two alphas would make that setting
    // mean something different at each end of the slider.
    expect(glass.bg).toMatch(/^rgba\(.*0\.8\)$/);
    expect(glass.bgSolid).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("draws its edges at a tenth of white, not with a border colour", () => {
    expect(glass.hair).toBe("rgba(255, 255, 255, 0.1)");
    expect(glass.border).toBe("rgba(255, 255, 255, 0.1)");
  });

  it("saturates as well as blurs, so colour behind the glass survives", () => {
    expect(glass.blur).toMatch(/blur\(\d+px\)\s+saturate\(\d+%\)/);
  });
});
