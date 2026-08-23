import type { AgentPost, AgentQuestion, Session } from "../types";

export type FeedRow =
  | { kind: "session"; session: Session; at: string }
  | { kind: "post"; post: AgentPost; at: string }
  | { kind: "question"; question: AgentQuestion; at: string };

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
  /**
   * Unanswered agent questions.
   *
   * Never muted and never filtered out by an app view: an agent is blocked
   * waiting on the answer, so hiding the question would strand it.
   */
  questions?: AgentQuestion[];
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
  const { pinAttention = false, appId = null, mutedApps = [], questions = [] } = options;

  const pending = questions.filter((q) => q.answer === null);
  const questionRows = pending.map((question) => ({
    kind: "question" as const,
    question,
    at: question.askedAt,
  }));

  // A per-app view is about that app. Including Claude sessions there would be
  // answering a question the user did not ask.
  if (appId) {
    const mine = questionRows.filter((row) => row.question.appId === appId);
    return [
      // An agent waiting on an answer stays at the top even here: it is blocked
      // until the user clicks.
      ...mine,
      ...posts
        .filter((post) => post.appId === appId)
        .map((post) => ({ kind: "post" as const, post, at: post.timestamp }))
        .sort(byRecency),
    ];
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
    ...questionRows,
  ];

  rows.sort(byRecency);

  if (!pinAttention) return rows;

  // A question outranks a waiting session: an agent is blocked on it, and it is
  // the only row in the feed with a deadline attached to somebody else's work.
  const isPinned = (row: FeedRow) =>
    row.kind === "question" || (row.kind === "session" && needsAttention(row.session));
  const questionFirst = (a: FeedRow, b: FeedRow) =>
    Number(b.kind === "question") - Number(a.kind === "question");
  return [
    ...rows.filter(isPinned).sort(questionFirst),
    ...rows.filter((row) => !isPinned(row)),
  ];
}
