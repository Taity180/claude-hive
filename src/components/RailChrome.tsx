import { invoke } from "@tauri-apps/api/core";

/**
 * Collapse and close, for the opened rail.
 *
 * Two distinct actions, deliberately: collapsing returns to the nub so the rail
 * stays available at the screen edge, while closing hides the window entirely
 * and leaves the `Rail` button in Hive as the way back. Before this there was
 * no way to do either — `close_rail` had existed in Rust since phase 2 with
 * nothing calling it.
 */
export function RailChrome({ onCollapse }: { onCollapse: () => void }) {
  return (
    <span className="flex items-center gap-0.5 shrink-0">
      <button
        type="button"
        aria-label="Collapse to the nub"
        title="Collapse to the nub"
        onClick={onCollapse}
        className="grid place-items-center rounded"
        style={{
          width: 20,
          height: 18,
          border: 0,
          background: "transparent",
          color: "var(--hub-text-muted)",
          cursor: "pointer",
        }}
      >
        <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 6h8" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>

      <button
        type="button"
        aria-label="Close the rail"
        title="Close the rail"
        onClick={() => {
          try {
            void Promise.resolve(invoke("close_rail")).catch((err) => {
              console.error("[hive] close_rail failed:", err);
            });
          } catch (err) {
            // invoke can throw synchronously when the IPC is unavailable.
            console.error("[hive] close_rail failed:", err);
          }
        }}
        className="grid place-items-center rounded"
        style={{
          width: 20,
          height: 18,
          border: 0,
          background: "transparent",
          color: "var(--hub-text-muted)",
          cursor: "pointer",
        }}
      >
        <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
    </span>
  );
}
