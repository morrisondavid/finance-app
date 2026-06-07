/**
 * Scheduled sync-all — loops linked accounts, writes status JSON, returns exit code.
 */

import type {
  FeedSyncScheduledAccountResult,
  FeedSyncScheduledStatus,
  FeedSyncRunTrigger,
} from '../../../shared/api-contracts.js';
import { computeFeedSyncDateFromNewestTransaction } from '../../../shared/feed-sync-window.js';
import { EnableBankingError } from './enable-banking.js';
import { listFeedSyncCandidates } from './feed-sync-candidates.js';
import { writeFeedSyncScheduledStatus } from './feed-sync-scheduled-status.js';
import { findLatestCsvDate, runFeedSync, FeedSyncError } from './sync.js';
import { TrueLayerError } from './truelayer/truelayer-error.js';
import { uploadDurableRelPathsToS3 } from '../../storage/s3-durable-sync.js';
import { FEED_SYNC_SCHEDULED_STATUS_REL_PATH } from '../../../shared/api-contracts.js';
import { PARSERS } from '../../parsers/index.js';
import { REPO_ROOT } from '../../repo-root.js';

const DEFAULT_LOOKBACK_DAYS = 3;

export function parseFeedSyncLookbackDaysFromEnv(
  raw: string | undefined = process.env.FEED_SYNC_LOOKBACK_DAYS,
): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_LOOKBACK_DAYS;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 14) {
    return DEFAULT_LOOKBACK_DAYS;
  }
  return n;
}

function errorCodeFromUnknown(err: unknown): string | undefined {
  if (err instanceof TrueLayerError || err instanceof EnableBankingError) {
    return err.code;
  }
  if (err instanceof FeedSyncError) {
    return err.code;
  }
  return undefined;
}

function errorMessageFromUnknown(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return 'Unknown error';
}

export interface RunScheduledFeedSyncAllResult {
  readonly status: FeedSyncScheduledStatus;
  readonly hadLinkedFailure: boolean;
  readonly syncedCount: number;
  readonly skippedUnlinkedCount: number;
}

/**
 * Sync every linked feed account; persist status for warnings + ops.
 */
export interface RunScheduledFeedSyncAllOpts {
  readonly lookbackDays?: number;
  readonly repoRoot?: string;
  readonly trigger?: FeedSyncRunTrigger;
}

export async function runScheduledFeedSyncAll(
  opts: RunScheduledFeedSyncAllOpts | number = {},
): Promise<RunScheduledFeedSyncAllResult> {
  const lookbackDays =
    typeof opts === 'number'
      ? opts
      : (opts.lookbackDays ?? parseFeedSyncLookbackDaysFromEnv());
  const repoRoot = typeof opts === 'number' ? REPO_ROOT : (opts.repoRoot ?? REPO_ROOT);
  const trigger =
    typeof opts === 'number' ? 'scheduled' : (opts.trigger ?? 'scheduled');
  const lastRunAt = new Date().toISOString();
  const accountResults: FeedSyncScheduledAccountResult[] = [];
  let hadLinkedFailure = false;
  let syncedCount = 0;
  let skippedUnlinkedCount = 0;

  for (const candidate of listFeedSyncCandidates()) {
    if (candidate.action === 'skip') {
      skippedUnlinkedCount += 1;
      continue;
    }

    syncedCount += 1;
    const parser = PARSERS[candidate.account];
    if (parser === undefined) {
      hadLinkedFailure = true;
      accountResults.push({
        account: candidate.account,
        status: 'failed',
        error: `No parser for ${candidate.account}`,
        code: 'unknown-account',
      });
      continue;
    }
    const latestCsvDate = findLatestCsvDate(candidate.account, parser);
    const dateFrom = computeFeedSyncDateFromNewestTransaction(latestCsvDate);

    try {
      const result = await runFeedSync(candidate.account, { dateFrom, lookbackDays });
      accountResults.push({
        account: candidate.account,
        status: 'ok',
        rowsFetched: result.rowsFetched,
        skipped: result.skipped,
        ingestOutcome: result.ingestOutcome,
      });
    } catch (err) {
      hadLinkedFailure = true;
      accountResults.push({
        account: candidate.account,
        status: 'failed',
        error: errorMessageFromUnknown(err),
        code: errorCodeFromUnknown(err),
      });
    }
  }

  const status: FeedSyncScheduledStatus = {
    lastRunAt,
    lastRunKind: trigger,
    lookbackDays,
    accounts: accountResults,
  };

  writeFeedSyncScheduledStatus(status, repoRoot);

  try {
    await uploadDurableRelPathsToS3([FEED_SYNC_SCHEDULED_STATUS_REL_PATH], 'feed-sync-scheduled');
  } catch (err) {
    console.error('[feed:sync-all] S3 durable upload failed:', err);
  }

  return { status, hadLinkedFailure, syncedCount, skippedUnlinkedCount };
}
