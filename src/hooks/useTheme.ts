import { useEffect, useState } from "react";
import { getThemeById, defaultTheme, type Theme } from "../themes";

const STORAGE_KEY = "claude-hive-theme";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? getThemeById(saved) : defaultTheme;
  });

  const setTheme = (themeId: string) => {
    const newTheme = getThemeById(themeId);
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, themeId);
  };

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--hub-bg", theme.bg);
    root.style.setProperty("--hub-bg-solid", theme.bgSolid);
    root.style.setProperty("--hub-surface", theme.surface);
    root.style.setProperty("--hub-border", theme.border);
    root.style.setProperty("--hub-text", theme.text);
    root.style.setProperty("--hub-text-muted", theme.textMuted);
    root.style.setProperty("--hub-accent", theme.accent);
    root.style.setProperty("--hub-accent-text", theme.accentText);
    root.style.setProperty("--hub-blur", theme.blur);
  }, [theme]);

  return { theme, setTheme };
}
