import { describe, it, expect } from 'vitest';
import type { FeedSyncResponse } from '../../../shared/api-contracts.js';
import {
  deriveFeedSyncAccountResult,
  deriveFeedSyncRunOutcome,
} from './feed-sync-account-result.js';

const baseWindow = { dateFrom: '2026-06-05', dateTo: '2026-06-08' };

function feedResult(overrides: Partial<FeedSyncResponse>): FeedSyncResponse {
  return {
    account: 'barclays-current',
    skipped: false,
    window: baseWindow,
    rowsFetched: 0,
    csvWritten: false,
    partitionedFiles: [],
    initDatabaseRan: false,
    ...overrides,
  };
}

describe('deriveFeedSyncAccountResult', () => {
  it('marks window skips as unchanged', () => {
    const row = deriveFeedSyncAccountResult(
      'barclays-current',
      feedResult({ skipped: true, reason: 'already_up_to_date', rowsFetched: 0 }),
    );
    expect(row).toMatchObject({
      status: 'unchanged',
      reason: 'already_up_to_date',
      rowsFetched: 0,
    });
  });

  it('marks duplicate ingest as unchanged even when rows were fetched', () => {
    const row = deriveFeedSyncAccountResult(
      'barclays-current',
      feedResult({
        rowsFetched: 2,
        csvWritten: false,
        ingestOutcome: 'duplicate',
        duplicateOriginalName: 'feed_2026-06-05_2026-06-08.csv',
        duplicateExistingPath: '/tmp/statements/barclays-current/_originals/feed_2026-06-05_2026-06-08.csv',
      }),
    );
    expect(row).toMatchObject({
      status: 'unchanged',
      reason: 'duplicate_csv',
      rowsFetched: 2,
      ingestOutcome: 'duplicate',
      duplicateOriginalName: 'feed_2026-06-05_2026-06-08.csv',
    });
  });

  it('marks ingested rows with database refresh as ingested', () => {
    const row = deriveFeedSyncAccountResult(
      'barclays-current',
      feedResult({
        rowsFetched: 2,
        csvWritten: true,
        ingestOutcome: 'ingested',
        initDatabaseRan: true,
        partitionedFiles: ['2026-06_transactions_barclays-current.csv'],
      }),
    );
    expect(row).toMatchObject({
      status: 'ingested',
      rowsFetched: 2,
      initDatabaseRan: true,
    });
  });

  it('marks deferred ingest as ingested with initDatabaseRan false', () => {
    const row = deriveFeedSyncAccountResult(
      'barclays-current',
      feedResult({
        rowsFetched: 2,
        csvWritten: true,
        ingestOutcome: 'ingested',
        initDatabaseRan: false,
        partitionedFiles: ['2026-06_transactions_barclays-current.csv'],
      }),
    );
    expect(row).toMatchObject({
      status: 'ingested',
      rowsFetched: 2,
      initDatabaseRan: false,
    });
  });
});

describe('deriveFeedSyncRunOutcome', () => {
  it('returns no_op when nothing was ingested and nothing failed', () => {
    expect(
      deriveFeedSyncRunOutcome([
        {
          account: 'barclays-current',
          status: 'unchanged',
          reason: 'duplicate_csv',
          rowsFetched: 2,
          window: baseWindow,
        },
      ]),
    ).toBe('no_op');
  });

  it('returns ok when at least one account ingested', () => {
    expect(
      deriveFeedSyncRunOutcome([
        {
          account: 'barclays-current',
          status: 'ingested',
          rowsFetched: 1,
          window: baseWindow,
          ingestOutcome: 'ingested',
          initDatabaseRan: true,
        },
      ]),
    ).toBe('ok');
  });
});
