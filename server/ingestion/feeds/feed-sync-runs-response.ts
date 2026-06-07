/**
 * Build `GET /api/feed/sync-runs` payload from durable log + scheduler.
 */

import type { FeedSyncRunsResponse } from '../../../shared/api-contracts.js';
import { readFeedSyncRunLog } from './feed-sync-run-log.js';
import { isFeedSyncOverdue } from './feed-sync-guard.js';
import { nextScheduledRunIso } from './feed-sync-scheduler.js';

export function buildFeedSyncRunsResponse(now: Date = new Date()): FeedSyncRunsResponse {
  const log = readFeedSyncRunLog();
  const lastRunAt = log.runs[0]?.finishedAt ?? null;
  return {
    runs: log.runs,
    lastRunAt,
    overdue: isFeedSyncOverdue(lastRunAt, now),
    nextScheduledRunAt: nextScheduledRunIso(now),
  };
}
