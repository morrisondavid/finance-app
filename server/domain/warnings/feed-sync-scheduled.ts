/**
 * Warnings from the last scheduled `feed:sync-all` run (`data/feed-sync-scheduled-status.json`).
 */

import type {
  AccountName,
  EntityFoundationWarning,
  FeedSyncScheduledStatus,
} from '../../../shared/api-contracts.js';
import { readFeedSyncScheduledStatus } from '../../ingestion/feeds/feed-sync-scheduled-status.js';

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
        : 'Check server logs (/var/log/bank-feed-sync.log) and retry sync for this account.',
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
