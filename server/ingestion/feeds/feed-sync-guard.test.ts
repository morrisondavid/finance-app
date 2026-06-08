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
          status: 'ingested',
          rowsFetched: 1,
          window: { dateFrom: '2026-06-05', dateTo: '2026-06-08' },
          ingestOutcome: 'ingested',
          initDatabaseRan: true,
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

  it('returns started immediately when detached while work continues', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const runScheduled = vi.fn(async () => {
      await gate;
      return scheduledResult(now.toISOString());
    });

    const started = await runFeedSyncAllGuarded({
      trigger: 'manual',
      repoRoot: tmpRoot,
      detached: true,
      deps: {
        clock: { now: clockNow },
        runScheduled,
        uploadRuns: vi.fn().mockResolvedValue(undefined),
      },
    });

    expect(started.state).toBe('started');
    if (started.state !== 'started') {
      return;
    }

    const blocked = await runFeedSyncAllGuarded({
      trigger: 'manual',
      repoRoot: tmpRoot,
      deps: { clock: { now: clockNow } },
    });
    expect(blocked.state).toBe('in-progress');

    release?.();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    expect(runScheduled).toHaveBeenCalledOnce();
    const log = readFeedSyncRunLog(tmpRoot);
    expect(log.runs).toHaveLength(1);
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

  it('writes operational events with the same run id', async () => {
    const { readFeedSyncEventsForRun } = await import('./feed-sync-event-log.js');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runFeedSyncAllGuarded({
      trigger: 'manual',
      repoRoot: tmpRoot,
      deps: {
        clock: { now: clockNow },
        runScheduled: async () => scheduledResult(now.toISOString()),
        uploadRuns: vi.fn().mockResolvedValue(undefined),
      },
    });

    expect(result.state).toBe('completed');
    if (result.state !== 'completed') {
      return;
    }
    const events = readFeedSyncEventsForRun(result.run.id, tmpRoot);
    expect(events.some(event => event.kind === 'run_start')).toBe(true);
    expect(events.some(event => event.kind === 'run_end')).toBe(true);
    expect(events.every(event => event.runId === result.run.id)).toBe(true);
  });

  it('records errorStack when scheduled runner throws', async () => {
    const { readFeedSyncEventsForRun } = await import('./feed-sync-event-log.js');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runFeedSyncAllGuarded({
      trigger: 'scheduled',
      repoRoot: tmpRoot,
      deps: {
        clock: { now: clockNow },
        runScheduled: async () => {
          throw new Error('scheduled runner exploded');
        },
        uploadRuns: vi.fn().mockResolvedValue(undefined),
      },
    });

    expect(result.state).toBe('completed');
    if (result.state !== 'completed') {
      return;
    }
    expect(result.run.outcome).toBe('failed');
    expect(result.run.error).toBe('scheduled runner exploded');
    expect(result.run.errorStack).toContain('Error: scheduled runner exploded');

    const events = readFeedSyncEventsForRun(result.run.id, tmpRoot);
    expect(events.some(event => event.kind === 'run_fatal')).toBe(true);
  });

  it('records no_op when sync ran but nothing ingested', async () => {
    const runScheduled = vi.fn(async () => ({
      status: {
        lastRunAt: now.toISOString(),
        lastRunKind: 'scheduled' as const,
        lookbackDays: 3,
        accounts: [
          {
            account: 'barclays-current' as const,
            status: 'unchanged' as const,
            reason: 'duplicate_csv',
            rowsFetched: 2,
            window: { dateFrom: '2026-06-05', dateTo: '2026-06-08' },
          },
        ],
      },
      hadLinkedFailure: false,
      syncedCount: 1,
      skippedUnlinkedCount: 0,
    }));

    const result = await runFeedSyncAllGuarded({
      trigger: 'manual',
      repoRoot: tmpRoot,
      deps: {
        clock: { now: clockNow },
        runScheduled,
        uploadRuns: vi.fn().mockResolvedValue(undefined),
      },
    });

    expect(result.state).toBe('completed');
    if (result.state === 'completed') {
      expect(result.run.outcome).toBe('no_op');
    }
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
