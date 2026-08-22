export interface Theme {
  name: string;
  id: string;
  bg: string;
  bgSolid: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  blur: string;
  /** 1px highlight on the top edge only — reads as a lit bevel. */
  spec: string;
  /** Hairline divider, inset from the left in lists. */
  hair: string;
  /** Third-level label, below textMuted. For timestamps and counts. */
  textDim: string;
  /** Background tint for the one row that is blocked on the user. */
  attention: string;
}

export const themes: Theme[] = [
  {
    id: "frosted-glass",
    name: "Frosted Glass",
    bg: "rgba(20, 20, 20, 0.75)",
    bgSolid: "#141414",
    surface: "rgba(255, 255, 255, 0.06)",
    border: "rgba(255, 255, 255, 0.1)",
    text: "#e5e5e5",
    textMuted: "rgba(255, 255, 255, 0.4)",
    accent: "#60a5fa",
    accentText: "#0a0a0a",
    blur: "blur(20px)",
    spec: "rgba(255, 255, 255, 0.16)",
    hair: "rgba(255, 255, 255, 0.09)",
    textDim: "rgba(255, 255, 255, 0.28)",
    attention: "rgba(234, 179, 8, 0.12)",
  },
  {
    id: "warm-neutral",
    name: "Warm Neutral",
    bg: "rgba(28, 25, 23, 0.85)",
    bgSolid: "#1c1917",
    surface: "rgba(255, 255, 255, 0.05)",
    border: "rgba(255, 255, 255, 0.08)",
    text: "#d6d3d1",
    textMuted: "#78716c",
    accent: "#f59e0b",
    accentText: "#1c1917",
    blur: "blur(16px)",
    spec: "rgba(255, 255, 255, 0.14)",
    hair: "rgba(255, 255, 255, 0.08)",
    textDim: "rgba(214, 211, 209, 0.32)",
    attention: "rgba(245, 158, 11, 0.13)",
  },
  {
    id: "cool-slate",
    name: "Cool Slate",
    bg: "rgba(15, 23, 42, 0.85)",
    bgSolid: "#0f172a",
    surface: "rgba(255, 255, 255, 0.05)",
    border: "rgba(255, 255, 255, 0.08)",
    text: "#cbd5e1",
    textMuted: "#64748b",
    accent: "#14b8a6",
    accentText: "#0f172a",
    blur: "blur(16px)",
    spec: "rgba(255, 255, 255, 0.14)",
    hair: "rgba(255, 255, 255, 0.08)",
    textDim: "rgba(203, 213, 225, 0.3)",
    attention: "rgba(20, 184, 166, 0.13)",
  },
  {
    id: "minimal-carbon",
    name: "Minimal Carbon",
    bg: "rgba(10, 10, 10, 0.9)",
    bgSolid: "#0a0a0a",
    surface: "rgba(255, 255, 255, 0.04)",
    border: "rgba(255, 255, 255, 0.06)",
    text: "#d4d4d4",
    textMuted: "#737373",
    accent: "#22c55e",
    accentText: "#0a0a0a",
    blur: "blur(12px)",
    spec: "rgba(255, 255, 255, 0.11)",
    hair: "rgba(255, 255, 255, 0.06)",
    textDim: "rgba(212, 212, 212, 0.28)",
    attention: "rgba(34, 197, 94, 0.12)",
  },
  {
    id: "nord",
    name: "Nord",
    bg: "rgba(46, 52, 64, 0.85)",
    bgSolid: "#2e3440",
    surface: "rgba(255, 255, 255, 0.05)",
    border: "rgba(255, 255, 255, 0.08)",
    text: "#eceff4",
    textMuted: "#7b88a1",
    accent: "#88c0d0",
    accentText: "#2e3440",
    blur: "blur(16px)",
    spec: "rgba(255, 255, 255, 0.15)",
    hair: "rgba(255, 255, 255, 0.09)",
    textDim: "rgba(236, 239, 244, 0.32)",
    attention: "rgba(136, 192, 208, 0.14)",
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    bg: "rgba(0, 43, 54, 0.85)",
    bgSolid: "#002b36",
    surface: "rgba(255, 255, 255, 0.05)",
    border: "rgba(255, 255, 255, 0.08)",
    text: "#fdf6e3",
    textMuted: "#657b83",
    accent: "#b58900",
    accentText: "#002b36",
    blur: "blur(16px)",
    spec: "rgba(255, 255, 255, 0.13)",
    hair: "rgba(255, 255, 255, 0.08)",
    textDim: "rgba(253, 246, 227, 0.28)",
    attention: "rgba(181, 137, 0, 0.16)",
  },
  {
    id: "dracula",
    name: "Dracula",
    bg: "rgba(40, 42, 54, 0.85)",
    bgSolid: "#282a36",
    surface: "rgba(255, 255, 255, 0.05)",
    border: "rgba(255, 255, 255, 0.08)",
    text: "#f8f8f2",
    textMuted: "#6272a4",
    accent: "#ff79c6",
    accentText: "#282a36",
    blur: "blur(16px)",
    spec: "rgba(255, 255, 255, 0.15)",
    hair: "rgba(255, 255, 255, 0.09)",
    textDim: "rgba(248, 248, 242, 0.3)",
    attention: "rgba(255, 121, 198, 0.13)",
  },
  {
    id: "monokai",
    name: "Monokai",
    bg: "rgba(39, 40, 34, 0.85)",
    bgSolid: "#272822",
    surface: "rgba(255, 255, 255, 0.05)",
    border: "rgba(255, 255, 255, 0.08)",
    text: "#f8f8f2",
    textMuted: "#75715e",
    accent: "#fd971f",
    accentText: "#272822",
    blur: "blur(16px)",
    spec: "rgba(255, 255, 255, 0.14)",
    hair: "rgba(255, 255, 255, 0.08)",
    textDim: "rgba(248, 248, 242, 0.3)",
    attention: "rgba(253, 151, 31, 0.14)",
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    bg: "rgba(30, 30, 46, 0.85)",
    bgSolid: "#1e1e2e",
    surface: "rgba(255, 255, 255, 0.05)",
    border: "rgba(255, 255, 255, 0.08)",
    text: "#cdd6f4",
    textMuted: "#6c7086",
    accent: "#b4befe",
    accentText: "#1e1e2e",
    blur: "blur(16px)",
    spec: "rgba(255, 255, 255, 0.15)",
    hair: "rgba(255, 255, 255, 0.09)",
    textDim: "rgba(205, 214, 244, 0.3)",
    attention: "rgba(180, 190, 254, 0.14)",
  },
  {
    id: "rose-pine",
    name: "Rose Pine",
    bg: "rgba(25, 23, 36, 0.85)",
    bgSolid: "#191724",
    surface: "rgba(255, 255, 255, 0.05)",
    border: "rgba(255, 255, 255, 0.08)",
    text: "#e0def4",
    textMuted: "#6e6a86",
    accent: "#ebbcba",
    accentText: "#191724",
    blur: "blur(16px)",
    spec: "rgba(255, 255, 255, 0.14)",
    hair: "rgba(255, 255, 255, 0.09)",
    textDim: "rgba(224, 222, 244, 0.3)",
    attention: "rgba(235, 188, 186, 0.14)",
  },
];

export const defaultTheme = themes[0];

export function getThemeById(id: string): Theme {
  return themes.find((t) => t.id === id) ?? defaultTheme;
}
