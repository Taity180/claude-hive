/** Rows per page in the feed. */
export const PAGE_SIZE = 50;

export interface Page<T> {
  rows: T[];
  /** 1-based, clamped into range. */
  page: number;
  pages: number;
}

/**
 * One page of a feed.
 *
 * The store keeps the last 1000 posts, which is a scroll nobody finishes. Paging
 * is clamped rather than validated: rows arrive and leave underneath the reader,
 * so a page number that was valid a second ago may not be, and an empty pane is
 * a worse answer than the nearest real page.
 */
export function paginate<T>(rows: T[], page: number, perPage = PAGE_SIZE): Page<T> {
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const clamped = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (clamped - 1) * perPage;
  return { rows: rows.slice(start, start + perPage), page: clamped, pages };
}
