/**
 * Idempotent guarded wrapper around `runScheduledFeedSyncAll`.
 * Single entry for scheduler, manual HTTP trigger, and CLI fallback.
 */

import { randomUUID } from 'crypto';
import type {
  FeedSyncRun,
  FeedSyncRunOutcome,
  FeedSyncRunTrigger,
} from '../../../shared/api-contracts.js';
import { FEED_SYNC_EVENTS_REL_PATH, FEED_SYNC_RUNS_REL_PATH } from '../../../shared/api-contracts.js';
import { deriveFeedSyncRunOutcome } from './feed-sync-account-result.js';
import {
  createFeedSyncRunLogger,
  formatFeedSyncError,
  type FeedSyncRunLogger,
} from './feed-sync-event-log.js';
import { appendFeedSyncRun, latestFeedSyncRun } from './feed-sync-run-log.js';
import {
  parseFeedSyncLookbackDaysFromEnv,
  runScheduledFeedSyncAll,
  type RunScheduledFeedSyncAllResult,
} from './run-scheduled-feed-sync-all.js';
import { uploadDurableRelPathsToS3 } from '../../storage/s3-durable-sync.js';

const DEFAULT_COOLDOWN_SECONDS = 60;

export interface FeedSyncGuardClock {
  now(): Date;
}

export interface FeedSyncGuardDeps {
  readonly clock?: FeedSyncGuardClock;
  readonly runScheduled?: (
    trigger: FeedSyncRunTrigger,
  ) => Promise<RunScheduledFeedSyncAllResult>;
  readonly appendRun?: typeof appendFeedSyncRun;
  readonly uploadRuns?: typeof uploadDurableRelPathsToS3;
}

export interface RunFeedSyncAllGuardedOpts {
  readonly trigger: FeedSyncRunTrigger;
  readonly lookbackDays?: number;
  readonly repoRoot?: string;
  readonly detached?: boolean;
  readonly deps?: FeedSyncGuardDeps;
}

export type FeedSyncAllGuardResult =
  | { readonly state: 'started'; readonly runId: string; readonly startedAt: string }
  | { readonly state: 'in-progress'; readonly startedAt: string }
  | { readonly state: 'deduped'; readonly run: FeedSyncRun }
  | { readonly state: 'completed'; readonly run: FeedSyncRun };

let lockStartedAt: string | null = null;

export function resetFeedSyncGuardForTests(): void {
  lockStartedAt = null;
}

export function parseFeedSyncCooldownSecondsFromEnv(
  raw: string | undefined = process.env.FEED_SYNC_COOLDOWN_SECONDS,
): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_COOLDOWN_SECONDS;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 0 || n > 3600) {
    return DEFAULT_COOLDOWN_SECONDS;
  }
  return n;
}

function outcomeFromResult(result: RunScheduledFeedSyncAllResult): FeedSyncRunOutcome {
  return deriveFeedSyncRunOutcome(result.status.accounts);
}

function buildFeedSyncRun(
  runId: string,
  trigger: FeedSyncRunTrigger,
  startedAt: Date,
  finishedAt: Date,
  result: RunScheduledFeedSyncAllResult,
): FeedSyncRun {
  return {
    id: runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    trigger,
    lookbackDays: result.status.lookbackDays,
    outcome: outcomeFromResult(result),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    accounts: result.status.accounts,
  };
}

function buildFailedRun(
  runId: string,
  trigger: FeedSyncRunTrigger,
  startedAt: Date,
  finishedAt: Date,
  lookbackDays: number,
  error: string,
  errorStack?: string,
): FeedSyncRun {
  return {
    id: runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    trigger,
    lookbackDays,
    outcome: 'failed',
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    accounts: [],
    error,
    ...(errorStack === undefined ? {} : { errorStack }),
  };
}

export async function runFeedSyncAllGuarded(
  opts: RunFeedSyncAllGuardedOpts,
): Promise<FeedSyncAllGuardResult> {
  const clock = opts.deps?.clock ?? { now: () => new Date() };
  const cooldownSeconds = parseFeedSyncCooldownSecondsFromEnv();
  const latest = latestFeedSyncRun(opts.repoRoot);

  if (lockStartedAt !== null) {
    return { state: 'in-progress', startedAt: lockStartedAt };
  }

  if (latest !== null && cooldownSeconds > 0) {
    const finishedMs = Date.parse(latest.finishedAt);
    const elapsedSeconds = (clock.now().getTime() - finishedMs) / 1000;
    if (elapsedSeconds < cooldownSeconds) {
      return { state: 'deduped', run: latest };
    }
  }

  const startedAt = clock.now();
  lockStartedAt = startedAt.toISOString();
  const runId = randomUUID();
  const repoRoot = opts.repoRoot;
  const logger: FeedSyncRunLogger = createFeedSyncRunLogger(runId, opts.trigger, repoRoot);

  logger.logEvent({
    kind: 'run_start',
    level: 'info',
    message: `Feed sync-all started (trigger=${opts.trigger})`,
    detail: {
      lookbackDays: opts.lookbackDays ?? parseFeedSyncLookbackDaysFromEnv(),
    },
  });

  const runScheduled =
    opts.deps?.runScheduled ??
    ((trigger: FeedSyncRunTrigger) =>
      runScheduledFeedSyncAll({
        lookbackDays: opts.lookbackDays,
        repoRoot,
        trigger,
        runLogger: logger,
      }));

  const appendRun = opts.deps?.appendRun ?? appendFeedSyncRun;
  const uploadRuns = opts.deps?.uploadRuns ?? uploadDurableRelPathsToS3;

  const work = async (): Promise<FeedSyncAllGuardResult> => {
    try {
      const result = await runScheduled(opts.trigger);
      const finishedAt = clock.now();
      const run = buildFeedSyncRun(runId, opts.trigger, startedAt, finishedAt, result);
      logger.logEvent({
        kind: 'run_end',
        level: result.hadLinkedFailure ? 'warn' : 'info',
        message: `Feed sync-all finished outcome=${outcomeFromResult(result)}`,
        detail: {
          durationMs: run.durationMs,
          syncedCount: result.syncedCount,
          skippedUnlinkedCount: result.skippedUnlinkedCount,
        },
      });
      appendRun(run, repoRoot);
      try {
        await uploadRuns([FEED_SYNC_RUNS_REL_PATH, FEED_SYNC_EVENTS_REL_PATH], 'feed-sync-runs');
      } catch (err) {
        console.error('[FeedSyncGuard] S3 durable upload failed:', err);
      }
      return { state: 'completed', run };
    } catch (err) {
      const finishedAt = clock.now();
      const formatted = formatFeedSyncError(err);
      const lookbackDays = opts.lookbackDays ?? parseFeedSyncLookbackDaysFromEnv();
      const run = buildFailedRun(
        runId,
        opts.trigger,
        startedAt,
        finishedAt,
        lookbackDays,
        formatted.message,
        formatted.stack,
      );
      logger.logEvent({
        kind: 'run_fatal',
        level: 'error',
        message: formatted.message,
        code: formatted.code,
        stack: formatted.stack,
        detail: formatted.cause === undefined ? undefined : { cause: formatted.cause },
      });
      appendRun(run, repoRoot);
      try {
        await uploadRuns([FEED_SYNC_RUNS_REL_PATH, FEED_SYNC_EVENTS_REL_PATH], 'feed-sync-runs');
      } catch (uploadErr) {
        console.error('[FeedSyncGuard] S3 durable upload failed:', uploadErr);
      }
      return { state: 'completed', run };
    } finally {
      lockStartedAt = null;
    }
  };

  if (opts.detached === true) {
    void work().catch(err => {
      console.error('[FeedSyncGuard] background sync failed:', err);
    });
    return { state: 'started', runId, startedAt: startedAt.toISOString() };
  }

  return await work();
}

/** True when the last completed run finished more than `thresholdHours` ago. */
export function isFeedSyncOverdue(
  lastRunAt: string | null,
  now: Date = new Date(),
  thresholdHours: number = 25,
): boolean {
  if (lastRunAt === null) {
    return true;
  }
  const finishedMs = Date.parse(lastRunAt);
  if (!Number.isFinite(finishedMs)) {
    return true;
  }
  const elapsedHours = (now.getTime() - finishedMs) / (1000 * 60 * 60);
  return elapsedHours >= thresholdHours;
}
