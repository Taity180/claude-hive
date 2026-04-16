interface TitleBarProps {
  title?: string;
  onBack?: () => void;
  children?: React.ReactNode;
}

export function TitleBar({ title, onBack, children }: TitleBarProps) {
  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch {}
  };

  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide();
    } catch {}
  };

  return (
    <div
      data-tauri-drag-region
      className="flex items-center gap-2.5 px-4 py-2 border-b select-none"
      style={{ borderColor: "var(--hub-border, #333)" }}
    >
      {onBack && (
        <button
          onClick={onBack}
          className="text-sm opacity-40 hover:opacity-70 transition-opacity"
          style={{ color: "var(--hub-text, #e5e5e5)" }}
        >
          ←
        </button>
      )}

      {title && (
        <>
          <div
            className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold shrink-0"
            style={{
              background: "var(--hub-accent, #60a5fa)",
              color: "var(--hub-accent-text, #0a0a0a)",
            }}
          >
            C
          </div>
          <span
            className="text-[13px] font-medium"
            style={{ color: "var(--hub-text, #e5e5e5)" }}
          >
            {title}
          </span>
        </>
      )}

      {children}

      {/* Window controls */}
      <div className="flex items-center gap-1 ml-auto">
        <button
          onClick={handleMinimize}
          className="w-6 h-6 flex items-center justify-center rounded transition-colors hover:bg-white/10"
          style={{ color: "var(--hub-text-muted, #777)" }}
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          onClick={handleClose}
          className="w-6 h-6 flex items-center justify-center rounded transition-colors hover:bg-red-500/80"
          style={{ color: "var(--hub-text-muted, #777)" }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
