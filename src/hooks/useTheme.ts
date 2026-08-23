import { useEffect, useState } from "react";
import { getThemeById, defaultTheme, glass, type Theme } from "../themes";

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
    // The surfaces do not vary: one dark-glass palette, so the app keeps its
    // character whichever accent is chosen.
    root.style.setProperty("--hub-bg", glass.bg);
    root.style.setProperty("--hub-bg-solid", glass.bgSolid);
    root.style.setProperty("--hub-surface", glass.surface);
    root.style.setProperty("--hub-border", glass.border);
    root.style.setProperty("--hub-text", glass.text);
    root.style.setProperty("--hub-text-muted", glass.textMuted);
    root.style.setProperty("--hub-text-dim", glass.textDim);
    root.style.setProperty("--hub-blur", glass.blur);
    root.style.setProperty("--hub-spec", glass.spec);
    root.style.setProperty("--hub-hair", glass.hair);

    // What a theme is actually for.
    root.style.setProperty("--hub-accent", theme.accent);
    root.style.setProperty("--hub-accent-text", theme.accentText);
    root.style.setProperty("--hub-attention", theme.attention);
  }, [theme]);

  return { theme, setTheme };
}
