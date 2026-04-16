import { useHubStore } from "../stores/hubStore";
import { useTheme } from "../hooks/useTheme";
import { ThemePicker } from "./ThemePicker";
import { TitleBar } from "./TitleBar";

export function Settings() {
  const setViewState = useHubStore((s) => s.setViewState);
  const { theme, setTheme } = useTheme();

  return (
    <div
      className="rounded-xl overflow-hidden shadow-xl"
      style={{
        background: "var(--hub-bg)",
        border: "1px solid var(--hub-border)",
        backdropFilter: "var(--hub-blur)",
        WebkitBackdropFilter: "var(--hub-blur)",
        width: "100%",
      }}
    >
      <TitleBar onBack={() => setViewState("expanded")}>
        <span
          className="text-[13px] font-medium"
          style={{ color: "var(--hub-text, #e5e5e5)" }}
        >
          Settings
        </span>
      </TitleBar>

      <div className="p-4 space-y-4">
        <div>
          <h3
            className="text-xs font-medium mb-2"
            style={{ color: "var(--hub-text)" }}
          >
            Theme
          </h3>
          <ThemePicker
            currentThemeId={theme.id}
            onSelect={setTheme}
          />
        </div>

        <div>
          <h3
            className="text-xs font-medium mb-2"
            style={{ color: "var(--hub-text)" }}
          >
            Plugin Setup
          </h3>
          <p
            className="text-[10px]"
            style={{ color: "var(--hub-text-muted)" }}
          >
            In any Claude Code session, run:
          </p>
          <div
            className="mt-1.5 rounded-lg px-3 py-2 text-[10px] font-mono"
            style={{
              background: "var(--hub-surface)",
              border: "1px solid var(--hub-border)",
              color: "var(--hub-text)",
            }}
          >
            /plugin marketplace add Taity180/claude-hive<br />
            /plugin install claude-hive@Taity180-claude-hive
          </div>
        </div>
      </div>
    </div>
  );
}
