import { useState, useRef, useEffect } from "react";
import { useHubStore } from "../stores/hubStore";
import { api } from "../api";
import type { Session } from "../types";

export function displayName(session: Session): string {
  return session.customName || session.projectName;
}

interface InlineRenameProps {
  session: Session;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Reveal the pencil only while the surrounding row is hovered. Rows that are
   * full width can afford this; the collapsed bar can't, because a pencil that
   * appears on hover changes the pill's width and reflows the whole wrapping
   * row under the cursor.
   */
  revealOnHover?: boolean;
  /** Called when the user enters or leaves edit mode. */
  onEditingChange?: (editing: boolean) => void;
}

export function InlineRename({
  session,
  className,
  style,
  revealOnHover = true,
  onEditingChange,
}: InlineRenameProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const stopEditing = () => {
    setEditing(false);
    onEditingChange?.(false);
  };

  const startEditing = () => {
    setValue(displayName(session));
    setEditing(true);
    onEditingChange?.(true);
  };

  const save = async () => {
    stopEditing();
    const trimmed = value.trim();
    const name = trimmed === session.projectName ? "" : trimmed;
    await fetch(`${api.baseUrl}/api/sessions/${session.id}/name`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    // Update local store
    useHubStore.getState().renameSession(session.id, name || null);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        aria-label={`Rename ${displayName(session)}`}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") save();
          if (e.key === "Escape") stopEditing();
        }}
        onKeyUp={(e) => {
          e.stopPropagation();
          if (e.key === " ") e.preventDefault();
        }}
        className={className}
        style={{
          ...style,
          background: "var(--hub-surface, rgba(255,255,255,0.1))",
          border: "1px solid var(--hub-accent, #60a5fa)",
          borderRadius: 4,
          outline: "none",
          padding: "0 4px",
          width: "100%",
          maxWidth: 180,
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <>
      <span className={className} style={style}>
        {displayName(session)}
      </span>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          startEditing();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            e.preventDefault();
            startEditing();
          }
        }}
        className={`shrink-0 transition-opacity cursor-pointer hover:!opacity-90 ${
          revealOnHover ? "opacity-0 group-hover:opacity-40" : "opacity-40"
        }`}
        title="Rename session"
        aria-label={`Rename ${displayName(session)}`}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--hub-text-muted, #777)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
      </span>
    </>
  );
}
