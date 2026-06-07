/**
 * Read/write `data/feed-sync-runs.json` — append-only run history (newest first).
 */

import fs from 'fs';
import path from 'path';
import {
  FEED_SYNC_RUNS_REL_PATH,
  FeedSyncRunLogSchema,
  type FeedSyncRun,
  type FeedSyncRunLog,
} from '../../../shared/api-contracts.js';
import { REPO_ROOT } from '../../repo-root.js';

export const FEED_SYNC_RUN_LOG_MAX_ENTRIES = 200;

export function feedSyncRunLogPath(root: string = REPO_ROOT): string {
  return path.join(root, FEED_SYNC_RUNS_REL_PATH);
}

export function readFeedSyncRunLog(root: string = REPO_ROOT): FeedSyncRunLog {
  const filePath = feedSyncRunLogPath(root);
  if (!fs.existsSync(filePath)) {
    return { runs: [] };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { runs: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { runs: [] };
  }
  const result = FeedSyncRunLogSchema.safeParse(parsed);
  return result.success ? result.data : { runs: [] };
}

export function writeFeedSyncRunLog(log: FeedSyncRunLog, root: string = REPO_ROOT): void {
  const filePath = feedSyncRunLogPath(root);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(log, null, 2)}\n`, 'utf-8');
}

export function appendFeedSyncRun(
  run: FeedSyncRun,
  root: string = REPO_ROOT,
  maxEntries: number = FEED_SYNC_RUN_LOG_MAX_ENTRIES,
): FeedSyncRunLog {
  const existing = readFeedSyncRunLog(root);
  const runs = [run, ...existing.runs].slice(0, maxEntries);
  const log: FeedSyncRunLog = { runs };
  writeFeedSyncRunLog(log, root);
  return log;
}

export function latestFeedSyncRun(root: string = REPO_ROOT): FeedSyncRun | null {
  const log = readFeedSyncRunLog(root);
  return log.runs[0] ?? null;
}
