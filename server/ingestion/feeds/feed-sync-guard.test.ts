import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { FeedSyncScheduledStatus } from '../../../shared/api-contracts.js';
import {
  isFeedSyncOverdue,
  parseFeedSyncCooldownSecondsFromEnv,
  resetFeedSyncGuardForTests,
  runFeedSyncAllGuarded,
} from './feed-sync-guard.js';
import { readFeedSyncRunLog } from './feed-sync-run-log.js';
import type { RunScheduledFeedSyncAllResult } from './run-scheduled-feed-sync-all.js';

function scheduledResult(at: string): RunScheduledFeedSyncAllResult {
  const status: FeedSyncScheduledStatus = {
    lastRunAt: at,
    lastRunKind: 'scheduled',
    lookbackDays: 3,
    accounts: [
      {
        account: 'barclays-current',
        status: 'ok',
        rowsFetched: 1,
        skipped: false,
      },
    ],
  };
  return {
    status,
    hadLinkedFailure: false,
    syncedCount: 1,
    skippedUnlinkedCount: 0,
  };
}

describe('feed-sync-guard', () => {
  let tmpRoot: string;
  let now: Date;
  let clockNow: () => Date;

  beforeEach(() => {
    resetFeedSyncGuardForTests();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-sync-guard-'));
    now = new Date('2026-06-03T16:05:00.000Z');
    clockNow = () => now;
  });

  it('parseFeedSyncCooldownSecondsFromEnv defaults to 60', () => {
    expect(parseFeedSyncCooldownSecondsFromEnv(undefined)).toBe(60);
    expect(parseFeedSyncCooldownSecondsFromEnv('30')).toBe(30);
    expect(parseFeedSyncCooldownSecondsFromEnv('not-a-number')).toBe(60);
  });

  it('dedupes when last run is within cooldown', async () => {
    const finishedAt = '2026-06-03T16:04:30.000Z';
    const runScheduled = vi.fn(async () => scheduledResult(finishedAt));

    const first = await runFeedSyncAllGuarded({
      trigger: 'manual',
      repoRoot: tmpRoot,
      deps: {
        clock: { now: clockNow },
        runScheduled,
        uploadRuns: vi.fn().mockResolvedValue(undefined),
      },
    });
    expect(first.state).toBe('completed');
    expect(runScheduled).toHaveBeenCalledOnce();

    const second = await runFeedSyncAllGuarded({
      trigger: 'manual',
      repoRoot: tmpRoot,
      deps: {
        clock: { now: clockNow },
        runScheduled,
        uploadRuns: vi.fn().mockResolvedValue(undefined),
      },
    });
    expect(second.state).toBe('deduped');
    if (second.state === 'deduped') {
      expect(second.run.finishedAt).toBe(now.toISOString());
    }
    expect(runScheduled).toHaveBeenCalledOnce();
  });

  it('returns in-progress while a run is active', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });

    const runScheduled = vi.fn(async () => {
      await gate;
      return scheduledResult(now.toISOString());
    });

    const firstPromise = runFeedSyncAllGuarded({
      trigger: 'scheduled',
      repoRoot: tmpRoot,
      deps: {
        clock: { now: clockNow },
        runScheduled,
        uploadRuns: vi.fn().mockResolvedValue(undefined),
      },
    });

    await Promise.resolve();

    const second = await runFeedSyncAllGuarded({
      trigger: 'manual',
      repoRoot: tmpRoot,
      deps: { clock: { now: clockNow } },
    });
    expect(second.state).toBe('in-progress');

    release?.();
    await firstPromise;
  });

  it('appends a completed run to the durable log', async () => {
    const result = await runFeedSyncAllGuarded({
      trigger: 'scheduled',
      repoRoot: tmpRoot,
      deps: {
        clock: { now: clockNow },
        runScheduled: async () => scheduledResult(now.toISOString()),
        uploadRuns: vi.fn().mockResolvedValue(undefined),
      },
    });

    expect(result.state).toBe('completed');
    const log = readFeedSyncRunLog(tmpRoot);
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]?.trigger).toBe('scheduled');
    expect(log.runs[0]?.outcome).toBe('ok');
  });
});

describe('isFeedSyncOverdue', () => {
  it('is overdue when no last run', () => {
    expect(isFeedSyncOverdue(null, new Date('2026-06-03T16:00:00.000Z'))).toBe(true);
  });

  it('is overdue after 25 hours', () => {
    expect(
      isFeedSyncOverdue('2026-06-01T16:00:00.000Z', new Date('2026-06-03T16:00:00.000Z')),
    ).toBe(true);
  });

  it('is not overdue within 25 hours', () => {
    expect(
      isFeedSyncOverdue('2026-06-03T10:00:00.000Z', new Date('2026-06-03T16:00:00.000Z')),
    ).toBe(false);
  });
});
