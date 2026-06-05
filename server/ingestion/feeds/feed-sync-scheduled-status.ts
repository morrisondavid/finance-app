/**
 * Read/write `data/feed-sync-scheduled-status.json` for cron observability + warnings.
 */

import fs from 'fs';
import path from 'path';
import {
  FEED_SYNC_SCHEDULED_STATUS_REL_PATH,
  FeedSyncScheduledStatusSchema,
  type FeedSyncScheduledStatus,
} from '../../../shared/api-contracts.js';
import { REPO_ROOT } from '../../repo-root.js';

export function feedSyncScheduledStatusPath(root: string = REPO_ROOT): string {
  return path.join(root, FEED_SYNC_SCHEDULED_STATUS_REL_PATH);
}

export function readFeedSyncScheduledStatus(
  root: string = REPO_ROOT,
): FeedSyncScheduledStatus | null {
  const filePath = feedSyncScheduledStatusPath(root);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const result = FeedSyncScheduledStatusSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function writeFeedSyncScheduledStatus(
  status: FeedSyncScheduledStatus,
  root: string = REPO_ROOT,
): void {
  const filePath = feedSyncScheduledStatusPath(root);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(status, null, 2)}\n`, 'utf-8');
}
