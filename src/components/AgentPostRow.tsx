import { AppIcon } from "./AppIcon";
import type { AgentPost } from "../types";

/**
 * Agents render monochrome, deliberately.
 *
 * Blue, amber, violet, red and green all mean *session status*. Giving an agent
 * a colour would make it read as a session in some state, and a tenth agent
 * would need a tenth colour. A white mark plus a text tag scales and never
 * collides.
 */
export function AgentPostRow({ post }: { post: AgentPost }) {
  return (
    <div
      data-testid="rail-row"
      data-row-kind="post"
      className="flex gap-2 px-2 py-1.5 rounded-lg"
    >
      <span
        className="shrink-0 grid place-items-center rounded-md mt-0.5"
        style={{ width: 20, height: 20, background: "#f2f4f8" }}
      >
        {post.appId ? (
          <AppIcon slug={post.appId} size={12} />
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3l9 16H3z"
              fill="none"
              stroke="#16181c"
              strokeWidth="2.4"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[12px] font-semibold truncate"
            style={{ color: "var(--hub-text)" }}
          >
            {post.agentName}
          </span>
          <span
            className="text-[8.5px] font-bold uppercase tracking-wide shrink-0 rounded px-1"
            style={{ background: "#e9ecf2", color: "#16181c" }}
          >
            Agent
          </span>
        </div>
        <div className="text-[11px] leading-snug" style={{ color: "var(--hub-text-muted)" }}>
          {post.content}
        </div>
      </div>
    </div>
  );
}
