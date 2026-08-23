/**
 * One dark-glass surface palette, ten accents.
 *
 * Every theme used to redefine the whole surface set, so the app's character
 * changed with the colour and the glass look was ten different looks. Now the
 * surfaces are fixed — translucent neutral, hairlines at 10% white — and a theme
 * contributes only what it is actually for: the accent that marks the thing you
 * are on, and the tint on a row that wants you.
 */

/** The dark-glass surfaces, identical under every accent. */
export const glass = {
  /** Translucent ground for overlays that sit above other content. */
  bg: "rgba(23, 23, 23, 0.8)",
  /**
   * The ground the rail and Hive paint. Opaque here: the rail's opacity setting
   * decides how much of the desktop shows through it, and multiplying two
   * alphas would make that setting mean something different at each end.
   */
  bgSolid: "#171717",
  surface: "rgba(255, 255, 255, 0.06)",
  border: "rgba(255, 255, 255, 0.1)",
  text: "#e7e7e7",
  textMuted: "rgba(255, 255, 255, 0.45)",
  textDim: "rgba(255, 255, 255, 0.3)",
  /** 1px highlight on the top edge only — reads as a lit bevel. */
  spec: "rgba(255, 255, 255, 0.14)",
  /** Hairline divider, inset from the left in lists. */
  hair: "rgba(255, 255, 255, 0.1)",
  /**
   * Blur for layers that genuinely sit over other page content, like Hive's
   * usage breakdown. It cannot blur the desktop — `backdrop-filter` samples the
   * page, not the screen — which is what the acrylic backdrop was for, and why
   * removing that was the end of the opening flash.
   */
  blur: "blur(12px) saturate(180%)",
} as const;

export interface Theme {
  id: string;
  name: string;
  /** Marks the active pane, the selected app, a primary button. */
  accent: string;
  /** Text on top of the accent. */
  accentText: string;
  /** Background tint for the one row that is blocked on the user. */
  attention: string;
}

export const themes: Theme[] = [
  {
    id: "frosted-glass",
    name: "Frosted Glass",
    accent: "#60a5fa",
    accentText: "#0a0a0a",
    attention: "rgba(234, 179, 8, 0.12)",
  },
  {
    id: "warm-neutral",
    name: "Warm Neutral",
    accent: "#f59e0b",
    accentText: "#1c1917",
    attention: "rgba(245, 158, 11, 0.13)",
  },
  {
    id: "cool-slate",
    name: "Cool Slate",
    accent: "#14b8a6",
    accentText: "#0f172a",
    attention: "rgba(20, 184, 166, 0.13)",
  },
  {
    id: "minimal-carbon",
    name: "Minimal Carbon",
    accent: "#22c55e",
    accentText: "#0a0a0a",
    attention: "rgba(34, 197, 94, 0.12)",
  },
  {
    id: "nord",
    name: "Nord",
    accent: "#88c0d0",
    accentText: "#2e3440",
    attention: "rgba(136, 192, 208, 0.14)",
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    accent: "#b58900",
    accentText: "#002b36",
    attention: "rgba(181, 137, 0, 0.16)",
  },
  {
    id: "dracula",
    name: "Dracula",
    accent: "#ff79c6",
    accentText: "#282a36",
    attention: "rgba(255, 121, 198, 0.13)",
  },
  {
    id: "monokai",
    name: "Monokai",
    accent: "#fd971f",
    accentText: "#272822",
    attention: "rgba(253, 151, 31, 0.14)",
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    accent: "#b4befe",
    accentText: "#1e1e2e",
    attention: "rgba(180, 190, 254, 0.14)",
  },
  {
    id: "rose-pine",
    name: "Rose Pine",
    accent: "#ebbcba",
    accentText: "#191724",
    attention: "rgba(235, 188, 186, 0.14)",
  },
];

export const defaultTheme = themes[0];

export function getThemeById(id: string | null | undefined): Theme {
  return themes.find((theme) => theme.id === id) ?? defaultTheme;
}
