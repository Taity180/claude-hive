import { describe, expect, it } from "vitest";
import { themes, getThemeById, defaultTheme } from "./index";

describe("theme tokens", () => {
  it("still exposes all ten themes", () => {
    expect(themes).toHaveLength(10);
  });

  it("gives every theme all four new tokens", () => {
    for (const theme of themes) {
      expect(theme.spec, `${theme.id} spec`).toMatch(/^rgba?\(/);
      expect(theme.hair, `${theme.id} hair`).toMatch(/^rgba?\(/);
      expect(theme.textDim, `${theme.id} textDim`).toBeTruthy();
      expect(theme.attention, `${theme.id} attention`).toBeTruthy();
    }
  });

  it("keeps the existing token contract intact", () => {
    expect(defaultTheme.id).toBe("frosted-glass");
    expect(getThemeById("nope")).toBe(defaultTheme);
    expect(defaultTheme.accent).toBe("#60a5fa");
  });
});
