import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { FeedSyncRun } from '../../../shared/api-contracts.js';
import {
  appendFeedSyncRun,
  readFeedSyncRunLog,
  FEED_SYNC_RUN_LOG_MAX_ENTRIES,
} from './feed-sync-run-log.js';

function sampleRun(id: string, finishedAt: string): FeedSyncRun {
  return {
    id,
    startedAt: finishedAt,
    finishedAt,
    trigger: 'scheduled',
    lookbackDays: 3,
    outcome: 'ok',
    durationMs: 100,
    accounts: [],
  };
}

describe('feed-sync-run-log', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-sync-run-log-'));
  });

  it('returns empty log when file is missing', () => {
    expect(readFeedSyncRunLog(tmpRoot)).toEqual({ runs: [] });
  });

  it('appends newest-first and caps entries', () => {
    for (let i = 0; i < FEED_SYNC_RUN_LOG_MAX_ENTRIES + 5; i += 1) {
      const minute = String(i % 60).padStart(2, '0');
      const hour = String(Math.floor(i / 60) % 24).padStart(2, '0');
      appendFeedSyncRun(
        sampleRun(`run-${String(i)}`, `2026-06-01T${hour}:${minute}:00.000Z`),
        tmpRoot,
      );
    }
    const log = readFeedSyncRunLog(tmpRoot);
    expect(log.runs).toHaveLength(FEED_SYNC_RUN_LOG_MAX_ENTRIES);
    expect(log.runs[0]?.id).toBe(`run-${String(FEED_SYNC_RUN_LOG_MAX_ENTRIES + 4)}`);
  });

  it('round-trips through read after append', () => {
    const run = sampleRun('abc', '2026-06-03T16:00:00.000Z');
    appendFeedSyncRun(run, tmpRoot);
    const log = readFeedSyncRunLog(tmpRoot);
    expect(log.runs).toEqual([run]);
  });
});
