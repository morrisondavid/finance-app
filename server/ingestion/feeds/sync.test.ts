/**
 * Unit tests for the §3.4 feed sync orchestration:
 *   - `resolveWindow` (pure)
 *   - `findLatestCsvDate` (filesystem-driven, exercised in a tmp dir)
 *   - `runFeedSync` (drives the whole pipeline; deps injected so the
 *      Enable Banking adapter, ingest function, and DB rebuild are
 *      replaced with controllable doubles).
 *
 * `getAccountConfig` is mocked at module scope so we can pretend any
 * account already has its `aispFeed.enableBanking.accountId` populated
 * without editing production data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import barclaysParser from '../../parsers/barclays.js';
import type { AccountName } from '../../domain/accounts/index.js';
import type { InternalFeedTransactions } from './model.js';
import type { IngestResult } from '../ingest-csv-file.js';

const { getAccountConfigMock } = vi.hoisted(() => ({
  getAccountConfigMock: vi.fn(),
}));

vi.mock('../../domain/accounts/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../domain/accounts/index.js')>(
    '../../domain/accounts/index.js',
  );
  return {
    ...actual,
    getAccountConfig: (name: AccountName) => getAccountConfigMock(name),
  };
});

const {
  resolveWindow,
  findLatestCsvDate,
  runFeedSync,
  requireLinkedAccount,
  FeedSyncError,
} = await import('./sync.js');

const { getAccountConfig: realGetAccountConfig } = await vi.importActual<
  typeof import('../../domain/accounts/index.js')
>('../../domain/accounts/index.js');

function passthrough(name: AccountName) {
  return realGetAccountConfig(name);
}

function linked(name: AccountName, accountId: string) {
  return { ...realGetAccountConfig(name), aispFeed: { enableBanking: { accountId } } };
}

beforeEach(() => {
  getAccountConfigMock.mockReset();
  getAccountConfigMock.mockImplementation(passthrough);
});

describe('resolveWindow', () => {
  it('uses today as dateTo when omitted', () => {
    const result = resolveWindow({ dateFrom: '2026-04-15' }, null, '2026-04-20');
    expect(result).toEqual({
      dateFrom: '2026-04-15',
      dateTo: '2026-04-20',
      skipped: false,
    });
  });

  it('passes dateTo through unchanged when supplied', () => {
    const result = resolveWindow({ dateFrom: '2026-04-15', dateTo: '2026-04-18' }, null, '2026-04-25');
    expect(result.dateTo).toBe('2026-04-18');
  });

  it('advances dateFrom past latestCsvDate when there is overlap', () => {
    const result = resolveWindow({ dateFrom: '2026-04-15' }, '2026-04-17', '2026-04-20');
    expect(result.dateFrom).toBe('2026-04-18');
    expect(result.skipped).toBe(false);
  });

  it('skips when latestCsvDate already covers the entire window', () => {
    const result = resolveWindow({ dateFrom: '2026-04-15', dateTo: '2026-04-17' }, '2026-04-17', '2026-04-20');
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_up_to_date');
  });

  it('does not advance when latestCsvDate is older than dateFrom', () => {
    const result = resolveWindow({ dateFrom: '2026-04-15' }, '2026-04-10', '2026-04-20');
    expect(result.dateFrom).toBe('2026-04-15');
    expect(result.skipped).toBe(false);
  });
});

describe('findLatestCsvDate', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-sync-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns null when the csv directory does not exist', () => {
    expect(findLatestCsvDate('barclays-current', barclaysParser, tmpRoot)).toBeNull();
  });

  it('returns the latest transaction date by reading the latest monthly file', () => {
    const csvDir = path.join(tmpRoot, 'barclays-current', 'csv');
    fs.mkdirSync(csvDir, { recursive: true });

    fs.writeFileSync(
      path.join(csvDir, '2026-03_transactions_barclays-current.csv'),
      'Number,Date,Account,Amount,Subcategory,Memo\n,15/03/2026,,-3.50,,COFFEE\n,20/03/2026,,1000.00,,SALARY\n',
    );
    fs.writeFileSync(
      path.join(csvDir, '2026-04_transactions_barclays-current.csv'),
      'Number,Date,Account,Amount,Subcategory,Memo\n,02/04/2026,,-3.50,,COFFEE\n,18/04/2026,,5.00,,REFUND\n',
    );

    const result = findLatestCsvDate('barclays-current', barclaysParser, tmpRoot);
    expect(result).toBe('2026-04-18');
  });

  it('returns null when there are no monthly transaction files', () => {
    const csvDir = path.join(tmpRoot, 'barclays-current', 'csv');
    fs.mkdirSync(csvDir, { recursive: true });
    fs.writeFileSync(path.join(csvDir, 'other.csv'), 'header,only\n');
    expect(findLatestCsvDate('barclays-current', barclaysParser, tmpRoot)).toBeNull();
  });
});

describe('requireLinkedAccount', () => {
  it('throws not-linked when aispFeed.enableBanking.accountId is missing', () => {
    getAccountConfigMock.mockImplementation(passthrough);
    expect(() => requireLinkedAccount('barclays-current')).toThrowError(FeedSyncError);
  });

  it('returns the parser + enableAccountId when linked', () => {
    getAccountConfigMock.mockImplementation((name: AccountName) =>
      name === 'barclays-current' ? linked('barclays-current', 'enable-uuid-1') : passthrough(name),
    );
    const result = requireLinkedAccount('barclays-current');
    expect(result.enableAccountId).toBe('enable-uuid-1');
    expect(result.parser).toBe(barclaysParser);
  });
});

describe('runFeedSync', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-run-test-'));
    getAccountConfigMock.mockImplementation((name: AccountName) =>
      name === 'barclays-current'
        ? linked('barclays-current', 'enable-uuid-test')
        : passthrough(name),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('skips fetch when the window is fully covered on disk', async () => {
    const fetchMock = vi.fn();
    const ingestMock = vi.fn();
    const initDbMock = vi.fn(async () => undefined);

    const result = await runFeedSync(
      'barclays-current',
      { dateFrom: '2026-04-15' },
      {
        fetchTransactions: fetchMock,
        ingestCsvFile: ingestMock,
        initDatabase: initDbMock,
        statementsDir: tmpRoot,
        today: () => '2026-04-20',
        findLatestCsvDate: () => '2026-04-22',
        tmpDir: () => tmpRoot,
      },
    );

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_up_to_date');
    expect(result.csvWritten).toBe(false);
    expect(result.initDatabaseRan).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ingestMock).not.toHaveBeenCalled();
    expect(initDbMock).not.toHaveBeenCalled();
  });

  it('returns skipped=false / csvWritten=false when the adapter returns zero rows', async () => {
    const empty: InternalFeedTransactions = {
      account: 'barclays-current',
      window: { dateFrom: '2026-04-15', dateTo: '2026-04-20' },
      rows: [],
    };
    const fetchMock = vi.fn(async () => empty);
    const ingestMock = vi.fn();
    const initDbMock = vi.fn(async () => undefined);

    const result = await runFeedSync(
      'barclays-current',
      { dateFrom: '2026-04-15' },
      {
        fetchTransactions: fetchMock,
        ingestCsvFile: ingestMock,
        initDatabase: initDbMock,
        statementsDir: tmpRoot,
        today: () => '2026-04-20',
        findLatestCsvDate: () => null,
        tmpDir: () => tmpRoot,
      },
    );

    expect(result.skipped).toBe(false);
    expect(result.csvWritten).toBe(false);
    expect(result.rowsFetched).toBe(0);
    expect(result.initDatabaseRan).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(ingestMock).not.toHaveBeenCalled();
    expect(initDbMock).not.toHaveBeenCalled();
  });

  it('writes a temp CSV with the parser-emitter output, calls ingest with overwrite=true on force, runs initDatabase on success', async () => {
    const internal: InternalFeedTransactions = {
      account: 'barclays-current',
      window: { dateFrom: '2026-04-15', dateTo: '2026-04-20' },
      rows: [
        { date: '2026-04-15', description: 'COFFEE', amount: -3.5, currency: 'GBP' },
        { date: '2026-04-16', description: 'SALARY', amount: 1200, currency: 'GBP' },
      ],
    };
    const fetchMock = vi.fn(async () => internal);

    let observedCsv: string | null = null;
    const ingestMock = vi.fn((_account: AccountName, filePath: string, originalName: string): IngestResult => {
      observedCsv = fs.readFileSync(filePath, 'utf-8');
      return {
        ok: true,
        outcome: 'ingested',
        originalSavedAt: '/dev/null',
        finalPath: '/dev/null',
        normalizedFilename: originalName,
        renamed: false,
        partition: { deleted: true, filesCreated: ['2026-04_transactions_barclays-current.csv'] },
      };
    });
    const initDbMock = vi.fn(async () => undefined);

    const result = await runFeedSync(
      'barclays-current',
      { dateFrom: '2026-04-15', force: true },
      {
        fetchTransactions: fetchMock,
        ingestCsvFile: ingestMock,
        initDatabase: initDbMock,
        statementsDir: tmpRoot,
        today: () => '2026-04-20',
        findLatestCsvDate: () => null,
        tmpDir: () => tmpRoot,
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const fetchArgs = fetchMock.mock.calls[0][0];
    expect(fetchArgs).toMatchObject({
      account: 'barclays-current',
      enableAccountId: 'enable-uuid-test',
      dateFrom: '2026-04-15',
      dateTo: '2026-04-20',
      currency: 'GBP',
    });

    expect(ingestMock).toHaveBeenCalledOnce();
    const ingestArgs = ingestMock.mock.calls[0];
    expect(ingestArgs[0]).toBe('barclays-current');
    expect(ingestArgs[2]).toBe('feed_2026-04-15_2026-04-20.csv');
    expect(ingestArgs[3]).toEqual({ overwrite: true });

    expect(observedCsv).not.toBeNull();
    expect(observedCsv).toContain('Number,Date,Account,Amount,Subcategory,Memo');
    expect(observedCsv).toContain('15/04/2026');
    expect(observedCsv).toContain('16/04/2026');

    expect(initDbMock).toHaveBeenCalledOnce();
    expect(result.csvWritten).toBe(true);
    expect(result.ingestOutcome).toBe('ingested');
    expect(result.partitionedFiles).toEqual(['2026-04_transactions_barclays-current.csv']);
    expect(result.initDatabaseRan).toBe(true);
  });

  it('does NOT call initDatabase when ingest reports a duplicate', async () => {
    const internal: InternalFeedTransactions = {
      account: 'barclays-current',
      window: { dateFrom: '2026-04-15', dateTo: '2026-04-20' },
      rows: [{ date: '2026-04-15', description: 'X', amount: -1, currency: 'GBP' }],
    };
    const fetchMock = vi.fn(async () => internal);
    const ingestMock = vi.fn((_account: AccountName, _filePath: string, originalName: string): IngestResult => ({
      ok: false,
      outcome: 'duplicate',
      originalName,
      existingPath: '/dev/null',
    }));
    const initDbMock = vi.fn(async () => undefined);

    const result = await runFeedSync(
      'barclays-current',
      { dateFrom: '2026-04-15' },
      {
        fetchTransactions: fetchMock,
        ingestCsvFile: ingestMock,
        initDatabase: initDbMock,
        statementsDir: tmpRoot,
        today: () => '2026-04-20',
        findLatestCsvDate: () => null,
        tmpDir: () => tmpRoot,
      },
    );

    expect(initDbMock).not.toHaveBeenCalled();
    expect(result.csvWritten).toBe(false);
    expect(result.ingestOutcome).toBe('duplicate');
    expect(result.initDatabaseRan).toBe(false);
  });
});
