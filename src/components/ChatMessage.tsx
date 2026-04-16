import type { Message } from "../types";

function formatTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function ChatMessage({ message }: { message: Message }) {
  const isUser = message.from === "user";
  const isBroadcast = message.from === "broadcast";

  const avatarLabel = isUser ? "Y" : isBroadcast ? "B" : "C";
  const fromLabel = isUser
    ? "You"
    : isBroadcast
      ? `Broadcast from ${message.fromSessionName ?? "unknown"}`
      : "Claude";

  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-1">
        <div
          className="w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold"
          style={{
            background: isUser
              ? "var(--hub-surface, rgba(255,255,255,0.06))"
              : "color-mix(in srgb, var(--hub-accent, #60a5fa) 20%, transparent)",
            color: isUser
              ? "var(--hub-text, #e5e5e5)"
              : "var(--hub-accent, #60a5fa)",
          }}
        >
          {avatarLabel}
        </div>
        <span
          className="text-[10px]"
          style={{ color: "var(--hub-text-muted)" }}
        >
          {fromLabel} · {formatTime(message.timestamp)}
        </span>
      </div>
      <p
        className="text-xs leading-relaxed pl-[22px] break-words whitespace-pre-wrap"
        style={{ color: "var(--hub-text, #e5e5e5)", overflowWrap: "anywhere" }}
      >
        {message.content}
      </p>
    </div>
  );
}
