/**
 * Guarded wrapper around {@link runFeedSync} for a single account.
 *
 * Mirrors the lock/cooldown/detached pattern from {@link runFeedSyncAllGuarded}
 * but orchestrates one account instead of all linked accounts. Shares the
 * same in-process lock so a single-account sync and a sync-all never run
 * concurrently.
 */

import { randomUUID } from 'crypto';
import type {
  AccountName,
  FeedSyncRun,
  FeedSyncRunOutcome,
  FeedSyncRunTrigger,
} from '../../../shared/api-contracts.js';
import { FEED_SYNC_EVENTS_REL_PATH, FEED_SYNC_RUNS_REL_PATH } from '../../../shared/api-contracts.js';
import { deriveFeedSyncAccountResult, deriveFeedSyncRunOutcome } from './feed-sync-account-result.js';
import {
  createFeedSyncRunLogger,
  formatFeedSyncError,
  type FeedSyncRunLogger,
} from './feed-sync-event-log.js';
import { appendFeedSyncRun, latestFeedSyncRun } from './feed-sync-run-log.js';
import {
  acquireFeedSyncLock,
  feedSyncLockStartedAt,
  isFeedSyncLocked,
  parseFeedSyncCooldownSecondsFromEnv,
  releaseFeedSyncLock,
  type FeedSyncGuardClock,
} from './feed-sync-guard.js';
import { runFeedSync, type RunFeedSyncDeps } from './sync.js';
import { uploadDurableRelPathsToS3 } from '../../storage/s3-durable-sync.js';

const DEFAULT_LOOKBACK_DAYS = 1;

export interface RunFeedSyncSingleGuardedOpts {
  readonly account: AccountName;
  readonly dateFrom: string;
  readonly dateTo?: string;
  readonly force?: boolean;
  readonly lookbackDays?: number;
  readonly trigger?: FeedSyncRunTrigger;
  readonly repoRoot?: string;
  readonly detached?: boolean;
  readonly deps?: RunFeedSyncDeps;
  readonly clock?: FeedSyncGuardClock;
}

export type FeedSyncSingleGuardResult =
  | { readonly state: 'started'; readonly runId: string; readonly startedAt: string }
  | { readonly state: 'in-progress'; readonly startedAt: string }
  | { readonly state: 'deduped'; readonly run: FeedSyncRun }
  | { readonly state: 'completed'; readonly run: FeedSyncRun };

function buildRun(
  runId: string,
  trigger: FeedSyncRunTrigger,
  startedAt: Date,
  finishedAt: Date,
  lookbackDays: number,
  accounts: FeedSyncRun['accounts'],
  outcome: FeedSyncRunOutcome,
): FeedSyncRun {
  return {
    id: runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    trigger,
    lookbackDays,
    outcome,
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    accounts,
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

export async function runFeedSyncSingleGuarded(
  opts: RunFeedSyncSingleGuardedOpts,
): Promise<FeedSyncSingleGuardResult> {
  const clock = opts.clock ?? { now: () => new Date() };
  const trigger: FeedSyncRunTrigger = opts.trigger ?? 'manual';
  const cooldownSeconds = parseFeedSyncCooldownSecondsFromEnv();
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const latest = latestFeedSyncRun(opts.repoRoot);

  if (isFeedSyncLocked()) {
    return { state: 'in-progress', startedAt: feedSyncLockStartedAt()! };
  }

  if (latest !== null && cooldownSeconds > 0) {
    const finishedMs = Date.parse(latest.finishedAt);
    const elapsedSeconds = (clock.now().getTime() - finishedMs) / 1000;
    if (elapsedSeconds < cooldownSeconds) {
      return { state: 'deduped', run: latest };
    }
  }

  const startedAt = clock.now();
  acquireFeedSyncLock(startedAt.toISOString());
  const runId = randomUUID();
  const logger: FeedSyncRunLogger = createFeedSyncRunLogger(runId, trigger, opts.repoRoot);

  logger.logEvent({
    kind: 'run_start',
    level: 'info',
    message: `Feed sync started for ${opts.account} (trigger=${trigger})`,
    detail: { account: opts.account, lookbackDays },
  });

  const work = async (): Promise<FeedSyncSingleGuardResult> => {
    try {
      logger.logEvent({
        kind: 'account_start',
        level: 'info',
        message: `Syncing ${opts.account}`,
        account: opts.account,
      });

      const result = await runFeedSync(
        opts.account,
        {
          dateFrom: opts.dateFrom,
          dateTo: opts.dateTo,
          force: opts.force,
          lookbackDays: opts.lookbackDays,
        },
        { ...opts.deps, runLogger: logger },
      );

      const accountResult = deriveFeedSyncAccountResult(opts.account, result);
      const outcome = deriveFeedSyncRunOutcome([accountResult]);
      const finishedAt = clock.now();
      const run = buildRun(runId, trigger, startedAt, finishedAt, lookbackDays, [accountResult], outcome);

      logger.logEvent({
        kind: 'run_end',
        level: outcome === 'failed' ? 'error' : 'info',
        message: `Feed sync finished outcome=${outcome}`,
        account: opts.account,
        detail: { durationMs: run.durationMs, rowsFetched: result.rowsFetched },
      });

      appendFeedSyncRun(run, opts.repoRoot);
      try {
        await uploadDurableRelPathsToS3([FEED_SYNC_RUNS_REL_PATH, FEED_SYNC_EVENTS_REL_PATH], 'feed-sync-runs');
      } catch (err) {
        console.error('[FeedSyncSingleGuard] S3 durable upload failed:', err);
      }
      return { state: 'completed', run };
    } catch (err) {
      const finishedAt = clock.now();
      const formatted = formatFeedSyncError(err);
      const run = buildFailedRun(
        runId,
        trigger,
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
        account: opts.account,
        detail: formatted.cause === undefined ? undefined : { cause: formatted.cause },
      });

      appendFeedSyncRun(run, opts.repoRoot);
      try {
        await uploadDurableRelPathsToS3([FEED_SYNC_RUNS_REL_PATH, FEED_SYNC_EVENTS_REL_PATH], 'feed-sync-runs');
      } catch (uploadErr) {
        console.error('[FeedSyncSingleGuard] S3 durable upload failed:', uploadErr);
      }
      return { state: 'completed', run };
    } finally {
      releaseFeedSyncLock();
    }
  };

  if (opts.detached === true) {
    void work().catch(err => {
      console.error('[FeedSyncSingleGuard] background sync failed:', err);
    });
    return { state: 'started', runId, startedAt: startedAt.toISOString() };
  }

  return await work();
}
