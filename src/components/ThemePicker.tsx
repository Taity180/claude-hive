import { themes } from "../themes";

interface ThemePickerProps {
  currentThemeId: string;
  onSelect: (themeId: string) => void;
}

export function ThemePicker({ currentThemeId, onSelect }: ThemePickerProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {themes.map((theme) => (
        <button
          key={theme.id}
          onClick={() => onSelect(theme.id)}
          className="flex items-center gap-2 rounded-lg p-2.5 text-left transition-all"
          style={{
            background:
              theme.id === currentThemeId
                ? "var(--hub-surface)"
                : "transparent",
            border:
              theme.id === currentThemeId
                ? `1px solid ${theme.accent}`
                : "1px solid var(--hub-border)",
          }}
        >
          <div className="flex gap-1">
            <span
              className="w-3 h-3 rounded-full"
              style={{ background: theme.bgSolid }}
            />
            <span
              className="w-3 h-3 rounded-full"
              style={{ background: theme.accent }}
            />
          </div>
          <span
            className="text-[11px]"
            style={{
              color:
                theme.id === currentThemeId
                  ? "var(--hub-text)"
                  : "var(--hub-text-muted)",
            }}
          >
            {theme.name}
          </span>
        </button>
      ))}
    </div>
  );
}
