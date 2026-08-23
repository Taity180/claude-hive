import { invoke } from "@tauri-apps/api/core";
import { useRailStore } from "../stores/railStore";

/**
 * Give Hive its own window back.
 *
 * Combined mode hides Hive's window and hosts its panes in the rail, so this
 * has to go through Rust: the rail holds no handle to Hive's window and cannot
 * unhide it directly.
 */
export function DetachHiveButton() {
  const setCombined = useRailStore((s) => s.setCombined);

  return (
    <button
      type="button"
      data-testid="detach-hive"
      onClick={() => {
        setCombined(false);
        void invoke("show_main_window").catch((err) => {
          console.error("[hive] show_main_window failed:", err);
        });
      }}
      className="text-[10px] px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
      style={{
        background: "var(--hub-surface)",
        color: "var(--hub-text-muted)",
        border: 0,
        cursor: "pointer",
      }}
      title="Give Hive its own window again"
    >
      Detach Hive
    </button>
  );
}
