import { useState, type KeyboardEvent } from "react";

interface ChatInputProps {
  placeholder: string;
  onSend: (message: string) => void;
}

export function ChatInput({ placeholder, onSend }: ChatInputProps) {
  const [value, setValue] = useState("");

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="flex items-center gap-2 p-2 border-t"
      style={{ borderColor: "var(--hub-border)" }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="flex-1 rounded-lg px-3 py-2 text-[11px] outline-none"
        style={{
          background: "var(--hub-surface)",
          border: "1px solid var(--hub-border)",
          color: "var(--hub-text)",
        }}
      />
      <button
        onClick={handleSend}
        className="w-7 h-7 rounded-md flex items-center justify-center text-xs shrink-0"
        style={{
          background: "rgba(96, 165, 250, 0.15)",
          color: "var(--hub-accent)",
        }}
      >
        ↑
      </button>
    </div>
  );
}
