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
  },
];

export const defaultTheme = themes[0];

export function getThemeById(id: string): Theme {
  return themes.find((t) => t.id === id) ?? defaultTheme;
}
