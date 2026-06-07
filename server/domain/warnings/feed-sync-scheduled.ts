/**
 * Warnings from the last scheduled `feed:sync-all` run (`data/feed-sync-scheduled-status.json`).
 */

import type {
  AccountName,
  EntityFoundationWarning,
  FeedSyncScheduledStatus,
} from '../../../shared/api-contracts.js';
import { readFeedSyncScheduledStatus } from '../../ingestion/feeds/feed-sync-scheduled-status.js';
import { latestFeedSyncRun } from '../../ingestion/feeds/feed-sync-run-log.js';
import { isFeedSyncOverdue } from '../../ingestion/feeds/feed-sync-guard.js';
import { nextScheduledRunIso } from '../../ingestion/feeds/feed-sync-scheduler.js';

function severityForFailureCode(code: string | undefined): 'warn' | 'critical' {
  if (code === 'expired-session' || code === 'sca-exceeded' || code === 'no-session') {
    return 'critical';
  }
  return 'warn';
}

function warningForFailedAccount(
  account: AccountName,
  error: string,
  code: string | undefined,
  lastRunAt: string,
): EntityFoundationWarning {
  const severity = severityForFailureCode(code);
  const codePart = code !== undefined ? ` [${code}]` : '';
  return {
    id: `feed-sync-scheduled-failed:${account}`,
    code: 'feed-sync-scheduled-failed',
    severity,
    title: `Scheduled bank feed sync failed: ${account}`,
    detail: `${error}${codePart} (last scheduled run ${lastRunAt}).`,
    recommended_action:
      severity === 'critical'
        ? 'Reconnect the bank feed for this account (TrueLayer or Enable), then run sync manually or wait for the next scheduled run.'
        : 'Open the Logs tab and retry sync for this account.',
    sources: ['feed-sync-scheduled', `account:${account}`],
    context: {
      account,
      lastRunAt,
      ...(code !== undefined ? { failureCode: code } : {}),
    },
  };
}

export function deriveFeedSyncScheduledWarnings(
  status: FeedSyncScheduledStatus | null = readFeedSyncScheduledStatus(),
): EntityFoundationWarning[] {
  if (status === null) {
    return [];
  }

  const warnings: EntityFoundationWarning[] = [];
  for (const row of status.accounts) {
    if (row.status === 'failed') {
      warnings.push(
        warningForFailedAccount(row.account, row.error, row.code, status.lastRunAt),
      );
    }
  }
  return warnings;
}

export function deriveFeedSyncOverdueWarning(
  lastRunAt: string | null = latestFeedSyncRun()?.finishedAt ?? null,
  now: Date = new Date(),
): EntityFoundationWarning | null {
  if (!isFeedSyncOverdue(lastRunAt, now)) {
    return null;
  }

  const nextRun = nextScheduledRunIso(now);
  const detail =
    lastRunAt === null
      ? 'No bank feed sync run has been recorded yet.'
      : `Last sync finished ${lastRunAt}. Expected twice daily (16:00 and 23:00 Europe/London).`;

  return {
    id: 'feed-sync-overdue',
    code: 'feed-sync-overdue',
    severity: 'critical',
    title: 'Bank feed sync is overdue',
    detail:
      nextRun !== null
        ? `${detail} Next scheduled run: ${nextRun}.`
        : detail,
    recommended_action:
      'Open the Logs tab to inspect recent runs, then use "Sync all now" or reconnect any failed bank feeds.',
    sources: ['feed-sync-scheduled'],
    context: {
      ...(lastRunAt !== null ? { lastRunAt } : {}),
      ...(nextRun !== null ? { nextScheduledRunAt: nextRun } : {}),
    },
  };
}

export function deriveAllFeedSyncScheduledWarnings(
  status: FeedSyncScheduledStatus | null = readFeedSyncScheduledStatus(),
  now: Date = new Date(),
): EntityFoundationWarning[] {
  const overdue = deriveFeedSyncOverdueWarning(
    latestFeedSyncRun()?.finishedAt ?? status?.lastRunAt ?? null,
    now,
  );
  const failureWarnings = deriveFeedSyncScheduledWarnings(status);
  return overdue !== null ? [overdue, ...failureWarnings] : failureWarnings;
}
