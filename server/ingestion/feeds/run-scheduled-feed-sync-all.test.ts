import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
const mocks = vi.hoisted(() => ({
  listFeedSyncCandidatesMock: vi.fn(),
  runFeedSyncMock: vi.fn(),
  findLatestCsvDateMock: vi.fn(),
  uploadMock: vi.fn(),
}));

vi.mock('./feed-sync-candidates.js', () => ({
  listFeedSyncCandidates: mocks.listFeedSyncCandidatesMock,
}));

vi.mock('./sync.js', async () => {
  const actual = await vi.importActual<typeof import('./sync.js')>('./sync.js');
  return {
    ...actual,
    runFeedSync: mocks.runFeedSyncMock,
    findLatestCsvDate: mocks.findLatestCsvDateMock,
  };
});

vi.mock('../../storage/s3-durable-sync.js', () => ({
  uploadDurableRelPathsToS3: mocks.uploadMock,
}));

const { runScheduledFeedSyncAll } = await import('./run-scheduled-feed-sync-all.js');
const { readFeedSyncScheduledStatus } = await import('./feed-sync-scheduled-status.js');

describe('runScheduledFeedSyncAll', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-sync-all-test-'));
    mocks.listFeedSyncCandidatesMock.mockReset();
    mocks.runFeedSyncMock.mockReset();
    mocks.findLatestCsvDateMock.mockReset();
    mocks.uploadMock.mockReset();
    mocks.uploadMock.mockResolvedValue(undefined);
    mocks.findLatestCsvDateMock.mockReturnValue('2026-05-01');
  });

  it('skips unlinked accounts silently and syncs linked ones', async () => {
    mocks.listFeedSyncCandidatesMock.mockReturnValue([
      { account: 'wise-ltd', action: 'skip' },
      { account: 'barclays-current', action: 'sync' },
    ]);
    mocks.runFeedSyncMock.mockResolvedValue({
      account: 'barclays-current',
      skipped: false,
      rowsFetched: 1,
      csvWritten: true,
      ingestOutcome: 'ingested',
      window: { dateFrom: '2026-05-02', dateTo: '2026-06-03' },
      partitionedFiles: [],
      initDatabaseRan: true,
    });

    const { hadLinkedFailure, syncedCount, skippedUnlinkedCount } =
      await runScheduledFeedSyncAll({ lookbackDays: 3, repoRoot: tmpRoot });

    expect(hadLinkedFailure).toBe(false);
    expect(syncedCount).toBe(1);
    expect(skippedUnlinkedCount).toBe(1);
    expect(mocks.runFeedSyncMock).toHaveBeenCalledWith('barclays-current', {
      dateFrom: '2026-05-02',
      lookbackDays: 3,
    });

    const written = readFeedSyncScheduledStatus(tmpRoot);
    expect(written?.accounts).toHaveLength(1);
    expect(written?.accounts[0]).toMatchObject({
      account: 'barclays-current',
      status: 'ok',
      rowsFetched: 1,
    });
  });

  it('returns hadLinkedFailure when sync throws', async () => {
    mocks.listFeedSyncCandidatesMock.mockReturnValue([
      { account: 'monzo-joint', action: 'sync' },
    ]);
    mocks.runFeedSyncMock.mockRejectedValue(new Error('TrueLayer down'));

    const { hadLinkedFailure } = await runScheduledFeedSyncAll({ lookbackDays: 3, repoRoot: tmpRoot });
    expect(hadLinkedFailure).toBe(true);
    const written = readFeedSyncScheduledStatus(tmpRoot);
    expect(written?.accounts[0]).toMatchObject({
      status: 'failed',
      error: 'TrueLayer down',
    });
  });
});
