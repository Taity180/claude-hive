import type { AgentPost, Session } from "../types";

export type FeedRow =
  | { kind: "session"; session: Session; at: string }
  | { kind: "post"; post: AgentPost; at: string };

export interface BuildFeedOptions {
  /** Keep sessions needing the user at the top, whatever the timestamps say. */
  pinAttention?: boolean;
  /** Restrict to one app's posts. Sessions are excluded entirely. */
  appId?: string | null;
  /**
   * App slugs demoted out of the merged feed.
   *
   * Only affects the merged view: a per-app view the user deliberately opened
   * still shows everything, and sessions are never muted — muting is about a
   * chatty app, not about hiding the user's own work.
   */
  mutedApps?: string[];
}

/**
 * "Needs attention" is waiting-or-error across the whole app — the CollapsedBar
 * filter and the tray badge count use the same definition.
 */
function needsAttention(session: Session): boolean {
  return session.status === "waiting_for_input" || session.status === "error";
}

/** Newest first. String compare is safe on ISO-8601 and avoids parsing every row. */
function byRecency(a: FeedRow, b: FeedRow): number {
  return b.at.localeCompare(a.at);
}

export function buildFeed(
  sessions: Session[],
  posts: AgentPost[],
  options: BuildFeedOptions = {}
): FeedRow[] {
  const { pinAttention = false, appId = null, mutedApps = [] } = options;

  // A per-app view is about that app. Including Claude sessions there would be
  // answering a question the user did not ask.
  if (appId) {
    return posts
      .filter((post) => post.appId === appId)
      .map((post) => ({ kind: "post" as const, post, at: post.timestamp }))
      .sort(byRecency);
  }

  const muted = new Set(mutedApps);
  const audible = posts.filter((post) => !post.appId || !muted.has(post.appId));

  const rows: FeedRow[] = [
    ...sessions.map((session) => ({
      kind: "session" as const,
      session,
      at: session.lastActivity ?? "",
    })),
    ...audible.map((post) => ({ kind: "post" as const, post, at: post.timestamp })),
  ];

  rows.sort(byRecency);

  if (!pinAttention) return rows;

  const isPinned = (row: FeedRow) => row.kind === "session" && needsAttention(row.session);
  return [...rows.filter(isPinned), ...rows.filter((row) => !isPinned(row))];
}
