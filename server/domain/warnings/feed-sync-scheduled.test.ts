import { describe, it, expect } from 'vitest';
import {
  deriveFeedSyncScheduledWarnings,
  deriveFeedSyncOverdueWarning,
} from './feed-sync-scheduled.js';
import type { FeedSyncScheduledStatus } from '../../../shared/api-contracts.js';

describe('deriveFeedSyncScheduledWarnings', () => {
  it('returns empty when status is null', () => {
    expect(deriveFeedSyncScheduledWarnings(null)).toEqual([]);
  });

  it('emits critical warning for expired-session', () => {
    const status: FeedSyncScheduledStatus = {
      lastRunAt: '2026-06-03T23:00:00.000Z',
      lastRunKind: 'scheduled',
      lookbackDays: 3,
      accounts: [
        {
          account: 'barclays-current',
          status: 'failed',
          error: 'Session expired',
          code: 'expired-session',
        },
      ],
    };
    const warnings = deriveFeedSyncScheduledWarnings(status);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('feed-sync-scheduled-failed');
    expect(warnings[0]?.severity).toBe('critical');
    expect(warnings[0]?.context?.account).toBe('barclays-current');
  });

  it('omits ingested and skipped rows', () => {
    const status: FeedSyncScheduledStatus = {
      lastRunAt: '2026-06-03T16:00:00.000Z',
      lastRunKind: 'scheduled',
      lookbackDays: 3,
      accounts: [
        {
          account: 'barclays-current',
          status: 'ingested',
          rowsFetched: 2,
          window: { dateFrom: '2026-06-01', dateTo: '2026-06-03' },
          ingestOutcome: 'ingested',
          initDatabaseRan: true,
        },
      ],
    };
    expect(deriveFeedSyncScheduledWarnings(status)).toEqual([]);
  });
});

describe('deriveFeedSyncOverdueWarning', () => {
  it('returns null when last run is recent', () => {
    expect(
      deriveFeedSyncOverdueWarning(
        '2026-06-03T10:00:00.000Z',
        new Date('2026-06-03T16:00:00.000Z'),
      ),
    ).toBeNull();
  });

  it('returns critical warning when overdue', () => {
    const warning = deriveFeedSyncOverdueWarning(
      '2026-06-01T16:00:00.000Z',
      new Date('2026-06-03T16:00:00.000Z'),
    );
    expect(warning?.code).toBe('feed-sync-overdue');
    expect(warning?.severity).toBe('critical');
  });

  it('returns warning when no runs recorded', () => {
    const warning = deriveFeedSyncOverdueWarning(null, new Date('2026-06-03T16:00:00.000Z'));
    expect(warning?.code).toBe('feed-sync-overdue');
  });
});
