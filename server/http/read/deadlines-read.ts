import { getAllDeadlines, getDeadline } from '../../db/repositories/deadlines.js';
import { buildDeadlineFeed } from '../../db/repositories/deadline-feed.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

export function parseDeadlineFeedExcludeCompleted(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw !== 'string') return false;
  return raw === '1' || raw === 'true';
}

/** GET /api/deadlines */
export function readDeadlinesRoot(): JsonReadResult {
  try {
    return jsonReadOk({ deadlines: getAllDeadlines() });
  } catch {
    console.error('[Deadlines read] GET error');
    return jsonReadFail(500, { error: 'Failed to list deadlines' });
  }
}

interface DeadlineFeedQuery {
  from?: unknown;
  to?: unknown;
  excludeCompleted?: unknown;
}

/** GET /api/deadlines/feed */
export function readDeadlinesFeedQuery(q: DeadlineFeedQuery): JsonReadResult {
  try {
    const from = typeof q.from === 'string' ? q.from : null;
    const to = typeof q.to === 'string' ? q.to : null;
    const excludeCompleted = parseDeadlineFeedExcludeCompleted(q.excludeCompleted);
    const items = buildDeadlineFeed({ from, to, excludeCompleted });
    return jsonReadOk({ items });
  } catch {
    console.error('[Deadlines read] feed error');
    return jsonReadFail(500, { error: 'Failed to build deadline feed' });
  }
}

/** GET /api/deadlines/:id */
export function readDeadlineById(idRaw: string): JsonReadResult {
  try {
    const deadline = getDeadline(idRaw);
    if (!deadline) {
      return jsonReadFail(404, { error: 'Deadline not found' });
    }
    return jsonReadOk({ deadline });
  } catch {
    console.error('[Deadlines read] GET :id error');
    return jsonReadFail(500, { error: 'Failed to fetch deadline' });
  }
}
