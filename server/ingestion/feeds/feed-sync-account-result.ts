/**
 * Map a single {@link runFeedSync} result to a durable log row with honest semantics.
 * "Fetched rows" ≠ "accounts updated".
 */

import type {
  AccountName,
  FeedSyncResponse,
  FeedSyncRunOutcome,
  FeedSyncScheduledAccountResult,
} from '../../../shared/api-contracts.js';

export function deriveFeedSyncAccountResult(
  account: AccountName,
  result: FeedSyncResponse,
): FeedSyncScheduledAccountResult {
  if (result.skipped) {
    return {
      account,
      status: 'unchanged',
      reason: result.reason ?? 'skipped',
      rowsFetched: 0,
      window: result.window,
    };
  }

  if (result.rowsFetched === 0) {
    return {
      account,
      status: 'unchanged',
      reason: 'no_transactions_in_window',
      rowsFetched: 0,
      window: result.window,
    };
  }

  if (result.ingestOutcome === 'duplicate') {
    return {
      account,
      status: 'unchanged',
      reason: 'duplicate_csv',
      rowsFetched: result.rowsFetched,
      window: result.window,
      ingestOutcome: 'duplicate',
      ...(result.duplicateOriginalName === undefined
        ? {}
        : { duplicateOriginalName: result.duplicateOriginalName }),
      ...(result.duplicateExistingPath === undefined
        ? {}
        : { duplicateExistingPath: result.duplicateExistingPath }),
    };
  }

  if (result.ingestOutcome === 'invalid') {
    return {
      account,
      status: 'failed',
      error: 'Feed CSV failed validation during ingest',
      code: 'invalid-csv',
    };
  }

  if (result.ingestOutcome === 'ingested') {
    return {
      account,
      status: 'ingested',
      rowsFetched: result.rowsFetched,
      window: result.window,
      ingestOutcome: 'ingested',
      initDatabaseRan: result.initDatabaseRan,
      partitionedFiles: result.partitionedFiles,
    };
  }

  return {
    account,
    status: 'unchanged',
    reason: 'ingest_did_not_apply',
    rowsFetched: result.rowsFetched,
    window: result.window,
    ingestOutcome: result.ingestOutcome,
  };
}

export function feedSyncSkippedCandidateResult(
  account: AccountName,
  reason: string = 'not_linked',
): FeedSyncScheduledAccountResult {
  return { account, status: 'skipped', reason };
}

export function deriveFeedSyncRunOutcome(
  accounts: readonly FeedSyncScheduledAccountResult[],
): FeedSyncRunOutcome {
  const ingestedCount = accounts.filter(row => row.status === 'ingested').length;
  const failedCount = accounts.filter(row => row.status === 'failed').length;

  if (ingestedCount > 0 && failedCount === 0) {
    return 'ok';
  }
  if (ingestedCount > 0 && failedCount > 0) {
    return 'partial';
  }
  if (failedCount > 0) {
    return 'failed';
  }
  return 'no_op';
}
