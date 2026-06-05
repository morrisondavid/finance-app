import { describe, it, expect } from 'vitest';
import { deriveFeedSyncScheduledWarnings } from './feed-sync-scheduled.js';
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

  it('omits ok and skipped rows', () => {
    const status: FeedSyncScheduledStatus = {
      lastRunAt: '2026-06-03T16:00:00.000Z',
      lastRunKind: 'scheduled',
      lookbackDays: 3,
      accounts: [
        {
          account: 'barclays-current',
          status: 'ok',
          rowsFetched: 2,
          skipped: false,
        },
      ],
    };
    expect(deriveFeedSyncScheduledWarnings(status)).toEqual([]);
  });
});
