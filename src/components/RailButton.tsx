import { openRail } from "../rail/openRail";

export function RailButton() {
  return (
    <button
      type="button"
      onClick={() => {
        void openRail().catch((err) => {
          console.error("[hive] open_rail failed:", err);
        });
      }}
      className="text-[10px] px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
      style={{
        background: "var(--hub-accent)",
        color: "var(--hub-accent-text)",
        border: 0,
        cursor: "pointer",
      }}
      title="Open the Hive rail"
    >
      Rail
    </button>
  );
}
