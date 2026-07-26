import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { FeedSyncResponse } from '../../../shared/api-contracts.js';
import {
  resetFeedSyncGuardForTests,
  acquireFeedSyncLock,
} from './feed-sync-guard.js';
import { runFeedSyncSingleGuarded } from './feed-sync-single-guard.js';
import { appendFeedSyncRun } from './feed-sync-run-log.js';

const runFeedSyncMock = vi.hoisted(() => vi.fn());

vi.mock('./sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sync.js')>();
  return {
    ...actual,
    runFeedSync: runFeedSyncMock,
  };
});

const SUCCESS_RESULT: FeedSyncResponse = {
  account: 'barclays-current',
  skipped: false,
  window: { dateFrom: '2026-06-05', dateTo: '2026-06-08' },
  rowsFetched: 3,
  csvWritten: true,
  ingestOutcome: 'ingested',
  partitionedFiles: ['2026-06_transactions_barclays-current.csv'],
  initDatabaseRan: true,
};

describe('feed-sync-single-guard', () => {
  let tmpRoot: string;
  let now: Date;
  let clock: { now: () => Date };

  beforeEach(() => {
    resetFeedSyncGuardForTests();
    runFeedSyncMock.mockReset();
    runFeedSyncMock.mockResolvedValue(SUCCESS_RESULT);
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-sync-single-guard-'));
    now = new Date('2026-06-03T16:05:00.000Z');
    clock = { now: () => now };
  });

  it('returns in-progress when lock is already held', async () => {
    acquireFeedSyncLock('2026-06-03T16:04:00.000Z');

    const result = await runFeedSyncSingleGuarded({
      account: 'barclays-current',
      dateFrom: '2026-06-01',
      clock,
      repoRoot: tmpRoot,
    });

    expect(result.state).toBe('in-progress');
    expect(result).toHaveProperty('startedAt', '2026-06-03T16:04:00.000Z');
  });

  it('returns deduped when last run is within cooldown', async () => {
    const finishedAt = new Date('2026-06-03T16:04:30.000Z');
    appendFeedSyncRun(
      {
        id: 'prior-run',
        startedAt: '2026-06-03T16:04:00.000Z',
        finishedAt: finishedAt.toISOString(),
        trigger: 'manual',
        lookbackDays: 1,
        outcome: 'ok',
        durationMs: 30000,
        accounts: [],
      },
      tmpRoot,
    );

    const result = await runFeedSyncSingleGuarded({
      account: 'barclays-current',
      dateFrom: '2026-06-01',
      clock,
      repoRoot: tmpRoot,
    });

    expect(result.state).toBe('deduped');
  });

  it('returns started immediately when detached and runs work in background', async () => {
    const result = await runFeedSyncSingleGuarded({
      account: 'barclays-current',
      dateFrom: '2026-06-01',
      detached: true,
      clock,
      repoRoot: tmpRoot,
      deps: { initDatabase: vi.fn(async () => undefined) },
    });

    expect(result.state).toBe('started');
    expect(result).toHaveProperty('runId');

    // Allow background work to settle
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  });

  it('returns completed with run when not detached', async () => {
    const result = await runFeedSyncSingleGuarded({
      account: 'barclays-current',
      dateFrom: '2026-06-01',
      detached: false,
      clock,
      repoRoot: tmpRoot,
      deps: { initDatabase: vi.fn(async () => undefined) },
    });

    expect(result.state).toBe('completed');
  });
});

