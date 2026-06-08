/**
 * Unit tests for the §3.4 feed sync orchestration:
 *   - `resolveWindow` (pure)
 *   - `findLatestCsvDate` (filesystem-driven, exercised in a tmp dir)
 *   - `runFeedSync` (drives the whole pipeline; deps injected so the
 *      Enable Banking adapter, ingest function, and DB rebuild are
 *      replaced with controllable doubles).
 *
 * `getAccountConfig` is mocked at module scope so we can pretend any
 * account already has `aispFeed` slices populated without editing production
 * data. TrueLayer tokens default to absent unless a test stubs
 * `getTrueLayerRefreshToken`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import barclaysParser from '../../parsers/barclays.js';
import type { AccountName } from '../../domain/accounts/index.js';
import type { InternalFeedTransactions } from './model.js';
import type { IngestResult, IngestCsvFileOptions } from '../ingest-csv-file.js';
import type { FetchEnableTransactionsRequest } from './enable-banking.js';
import type { FetchTrueLayerTransactionsRequest } from './truelayer/truelayer-transactions.js';
import { fetchTrueLayerTransactions } from './truelayer/truelayer-transactions.js';
import type { FetchLike } from './truelayer/truelayer-auth-http.js';
import {
  TRUE_LAYER_ACCOUNT_ID,
  canonicalTrueLayerRawTransactions,
  canonicalTrueLayerCardRawTransactions,
  makeTrueLayerTransactionsEnvelope,
} from './truelayer/truelayer-transaction-fixtures.js';
import { PARSERS } from '../../parsers/index.js';
import { isCreditCard } from '../../domain/accounts/index.js';

const mockDeps = vi.hoisted(() => ({
  getAccountConfigMock: vi.fn(),
  /** Default: no TL token — selects Enable when EB account id is set. */
  resolveTrueLayerRefreshTokenMock: vi.fn(() => undefined as string | undefined),
  removeTrueLayerRefreshTokenMock: vi.fn(),
}));

const getAccountConfigMock = mockDeps.getAccountConfigMock;
const resolveTrueLayerRefreshTokenMock = mockDeps.resolveTrueLayerRefreshTokenMock;
const removeTrueLayerRefreshTokenMock = mockDeps.removeTrueLayerRefreshTokenMock;

vi.mock('../../domain/accounts/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../domain/accounts/index.js')>(
    '../../domain/accounts/index.js',
  );
  return {
    ...actual,
    getAccountConfig: (name: AccountName) => getAccountConfigMock(name),
  };
});

vi.mock('./truelayer/truelayer-tokens.js', async () => {
  const actual = await vi.importActual<typeof import('./truelayer/truelayer-tokens.js')>(
    './truelayer/truelayer-tokens.js',
  );
  return {
    ...actual,
    getTrueLayerRefreshToken: actual.getTrueLayerRefreshToken,
    resolveTrueLayerRefreshToken: (_name: AccountName): string | undefined =>
      resolveTrueLayerRefreshTokenMock(),
    resolveTrueLayerRefreshTokenSource: actual.resolveTrueLayerRefreshTokenSource,
    removeTrueLayerRefreshToken: (...args: Parameters<typeof actual.removeTrueLayerRefreshToken>) =>
      removeTrueLayerRefreshTokenMock(...args),
  };
});

const {
  resolveWindow,
  findLatestCsvDate,
  runFeedSync,
  requireLinkedFeed,
  FeedSyncError,
} = await import('./sync.js');

const { getAccountConfig: realGetAccountConfig } = await vi.importActual<
  typeof import('../../domain/accounts/index.js')
>('../../domain/accounts/index.js');

const { TrueLayerError } = await vi.importActual<
  typeof import('./truelayer/truelayer-error.js')
>('./truelayer/truelayer-error.js');

function passthrough(name: AccountName) {
  return realGetAccountConfig(name);
}

function linked(name: AccountName, accountId: string) {
  return { ...realGetAccountConfig(name), aispFeed: { enableBanking: { accountId } } };
}

beforeEach(() => {
  getAccountConfigMock.mockReset();
  getAccountConfigMock.mockImplementation(passthrough);
  resolveTrueLayerRefreshTokenMock.mockReset();
  resolveTrueLayerRefreshTokenMock.mockImplementation(() => undefined);
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

  it('with lookbackDays re-opens window when latestCsvDate is today', () => {
    const result = resolveWindow(
      { dateFrom: '2026-04-15', lookbackDays: 3 },
      '2026-04-20',
      '2026-04-20',
    );
    expect(result.skipped).toBe(false);
    expect(result.dateFrom).toBe('2026-04-18');
    expect(result.dateTo).toBe('2026-04-20');
  });

  it('with lookbackDays uses max(dateFrom, refreshFrom)', () => {
    const result = resolveWindow(
      { dateFrom: '2026-04-19', lookbackDays: 3 },
      '2026-04-20',
      '2026-04-20',
    );
    expect(result.dateFrom).toBe('2026-04-19');
    expect(result.skipped).toBe(false);
  });

  it('incremental path unchanged when lookbackDays unset', () => {
    const result = resolveWindow({ dateFrom: '2026-04-15', dateTo: '2026-04-17' }, '2026-04-17', '2026-04-20');
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_up_to_date');
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

describe('requireLinkedFeed', () => {
  it('throws not-linked when no Enable id and no TrueLayer link', () => {
    getAccountConfigMock.mockImplementation(passthrough);
    expect(() => requireLinkedFeed('barclays-current')).toThrowError(FeedSyncError);
  });

  it('returns enable branch when Enable account id is set', () => {
    getAccountConfigMock.mockImplementation((name: AccountName) =>
      name === 'barclays-current' ? linked('barclays-current', 'enable-uuid-1') : passthrough(name),
    );
    const result = requireLinkedFeed('barclays-current');
    expect(result.provider).toBe('enable');
    expect(result.enable?.enableAccountId).toBe('enable-uuid-1');
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
    removeTrueLayerRefreshTokenMock.mockClear();
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
        fetchEnableTransactions: fetchMock,
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
    const fetchMock = vi.fn(async (_req: FetchEnableTransactionsRequest) => empty);
    const ingestMock = vi.fn();
    const initDbMock = vi.fn(async () => undefined);

    const result = await runFeedSync(
      'barclays-current',
      { dateFrom: '2026-04-15' },
      {
        fetchEnableTransactions: fetchMock,
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

  it('removes TrueLayer refresh token on sca-exceeded before rethrowing', async () => {
    resolveTrueLayerRefreshTokenMock.mockReturnValue('sync-refresh-token');
    getAccountConfigMock.mockImplementation((name: AccountName) => ({
      ...realGetAccountConfig(name),
      aispFeed: { trueLayer: { dataAccountId: TRUE_LAYER_ACCOUNT_ID } },
    }));

    const fetchTl = vi.fn().mockRejectedValue(new TrueLayerError('sca-exceeded', 'SCA expired'));
    const ebFetch = vi.fn();

    await expect(
      runFeedSync(
        'barclays-current',
        { dateFrom: '2026-04-15', force: true },
        {
          fetchEnableTransactions: ebFetch,
          fetchTrueLayerTransactions: fetchTl,
          statementsDir: tmpRoot,
          today: () => '2026-04-20',
          findLatestCsvDate: () => null,
          tmpDir: () => tmpRoot,
        },
      ),
    ).rejects.toMatchObject({ code: 'sca-exceeded' });

    expect(removeTrueLayerRefreshTokenMock).toHaveBeenCalledOnce();
    expect(removeTrueLayerRefreshTokenMock).toHaveBeenCalledWith('barclays-current');
    expect(ebFetch).not.toHaveBeenCalled();
  });

  it('removes TrueLayer refresh token on expired-session before rethrowing', async () => {
    resolveTrueLayerRefreshTokenMock.mockReturnValue('sync-refresh-token');
    getAccountConfigMock.mockImplementation((name: AccountName) => ({
      ...realGetAccountConfig(name),
      aispFeed: { trueLayer: { dataAccountId: TRUE_LAYER_ACCOUNT_ID } },
    }));

    const fetchTl = vi.fn().mockRejectedValue(new TrueLayerError('expired-session', 'expired'));
    const ebFetch = vi.fn();

    await expect(
      runFeedSync(
        'barclays-current',
        { dateFrom: '2026-04-15', force: true },
        {
          fetchEnableTransactions: ebFetch,
          fetchTrueLayerTransactions: fetchTl,
          statementsDir: tmpRoot,
          today: () => '2026-04-20',
          findLatestCsvDate: () => null,
          tmpDir: () => tmpRoot,
        },
      ),
    ).rejects.toMatchObject({ code: 'expired-session' });

    expect(removeTrueLayerRefreshTokenMock).toHaveBeenCalledOnce();
    expect(removeTrueLayerRefreshTokenMock).toHaveBeenCalledWith('barclays-current');
  });

  it('does not remove token on other TrueLayer errors', async () => {
    resolveTrueLayerRefreshTokenMock.mockReturnValue('sync-refresh-token');
    getAccountConfigMock.mockImplementation((name: AccountName) => ({
      ...realGetAccountConfig(name),
      aispFeed: { trueLayer: { dataAccountId: TRUE_LAYER_ACCOUNT_ID } },
    }));

    const fetchTl = vi.fn().mockRejectedValue(new TrueLayerError('http-error', 'upstream 500'));

    await expect(
      runFeedSync(
        'barclays-current',
        { dateFrom: '2026-04-15', force: true },
        {
          fetchTrueLayerTransactions: fetchTl,
          statementsDir: tmpRoot,
          today: () => '2026-04-20',
          findLatestCsvDate: () => null,
          tmpDir: () => tmpRoot,
        },
      ),
    ).rejects.toMatchObject({ code: 'http-error' });

    expect(removeTrueLayerRefreshTokenMock).not.toHaveBeenCalled();
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
    const fetchMock = vi.fn(async (_req: FetchEnableTransactionsRequest) => internal);

    let observedCsv: string | null = null;
    const ingestMock = vi.fn(
      (_account: AccountName, filePath: string, originalName: string, _options: IngestCsvFileOptions): IngestResult => {
      observedCsv = fs.readFileSync(filePath, 'utf-8');
      return {
        ok: true,
        outcome: 'ingested',
        originalSavedAt: '/dev/null',
        finalPath: '/dev/null',
        normalizedFilename: originalName,
        renamed: false,
        partition: {
          deleted: true,
          filesCreated: ['2026-04_transactions_barclays-current.csv'],
          originalFile: '',
          totalRows: 2,
          rowsByMonth: new Map([
            ['2026-04', 2],
          ]),
        },
      };
    });
    const initDbMock = vi.fn(async () => undefined);

    const result = await runFeedSync(
      'barclays-current',
      { dateFrom: '2026-04-15', force: true },
      {
        fetchEnableTransactions: fetchMock,
        ingestCsvFile: ingestMock,
        initDatabase: initDbMock,
        statementsDir: tmpRoot,
        today: () => '2026-04-20',
        findLatestCsvDate: () => null,
        tmpDir: () => tmpRoot,
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const fetchArgs = fetchMock.mock.calls[0]?.[0];
    expect(fetchArgs).toBeDefined();
    expect(fetchArgs).toMatchObject({
      account: 'barclays-current',
      enableAccountId: 'enable-uuid-test',
      dateFrom: '2026-04-15',
      dateTo: '2026-04-20',
      currency: 'GBP',
    });

    expect(ingestMock).toHaveBeenCalledOnce();
    const ingestArgs = ingestMock.mock.calls[0];
    expect(ingestArgs).toBeDefined();
    expect(ingestArgs?.[0]).toBe('barclays-current');
    expect(ingestArgs?.[2]).toBe('feed_2026-04-15_2026-04-20.csv');
    expect(ingestArgs?.[3]).toEqual({ overwrite: true });

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

  it('does NOT call initDatabase when deferDbReinit is true even on ingest', async () => {
    const internal: InternalFeedTransactions = {
      account: 'barclays-current',
      window: { dateFrom: '2026-04-15', dateTo: '2026-04-20' },
      rows: [
        { date: '2026-04-15', description: 'COFFEE', amount: -3.5, currency: 'GBP' },
      ],
    };
    const fetchMock = vi.fn(async (_req: FetchEnableTransactionsRequest) => internal);
    const ingestMock = vi.fn(
      (_account: AccountName, _filePath: string, originalName: string, _options: IngestCsvFileOptions): IngestResult => ({
        ok: true,
        outcome: 'ingested',
        originalSavedAt: '/dev/null',
        finalPath: '/dev/null',
        normalizedFilename: originalName,
        renamed: false,
        partition: {
          deleted: true,
          filesCreated: ['2026-04_transactions_barclays-current.csv'],
          originalFile: '',
          totalRows: 1,
          rowsByMonth: new Map([['2026-04', 1]]),
        },
      }),
    );
    const initDbMock = vi.fn(async () => undefined);

    const result = await runFeedSync(
      'barclays-current',
      { dateFrom: '2026-04-15', force: true, deferDbReinit: true },
      {
        fetchEnableTransactions: fetchMock,
        ingestCsvFile: ingestMock,
        initDatabase: initDbMock,
        statementsDir: tmpRoot,
        today: () => '2026-04-20',
        findLatestCsvDate: () => null,
        tmpDir: () => tmpRoot,
      },
    );

    expect(initDbMock).not.toHaveBeenCalled();
    expect(result.ingestOutcome).toBe('ingested');
    expect(result.initDatabaseRan).toBe(false);
  });

  it('passes aispFeed.enableBanking.feedCurrency to fetch when set', async () => {
    getAccountConfigMock.mockImplementation((name: AccountName) =>
      name === 'barclays-current'
        ? {
            ...realGetAccountConfig('barclays-current'),
            aispFeed: { enableBanking: { accountId: 'enable-uuid-test', feedCurrency: 'EUR' } },
          }
        : passthrough(name),
    );

    const internal: InternalFeedTransactions = {
      account: 'barclays-current',
      window: { dateFrom: '2026-04-15', dateTo: '2026-04-20' },
      rows: [{ date: '2026-04-15', description: 'X', amount: -1, currency: 'EUR' }],
    };
    const fetchMock = vi.fn(async (_req: FetchEnableTransactionsRequest) => internal);
    const ingestMock = vi.fn(
      (
        _account: AccountName,
        _filePath: string,
        originalName: string,
        _options: IngestCsvFileOptions,
      ): IngestResult => ({
      ok: false,
      outcome: 'duplicate',
      originalName,
      existingPath: '/dev/null',
    }));
    const initDbMock = vi.fn(async () => undefined);

    await runFeedSync(
      'barclays-current',
      { dateFrom: '2026-04-15' },
      {
        fetchEnableTransactions: fetchMock,
        ingestCsvFile: ingestMock,
        initDatabase: initDbMock,
        statementsDir: tmpRoot,
        today: () => '2026-04-20',
        findLatestCsvDate: () => null,
        tmpDir: () => tmpRoot,
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const fetchArg = fetchMock.mock.calls[0]?.[0];
    expect(fetchArg).toBeDefined();
    expect(fetchArg?.currency).toBe('EUR');
  });

  it('does NOT call initDatabase when ingest reports a duplicate', async () => {
    const internal: InternalFeedTransactions = {
      account: 'barclays-current',
      window: { dateFrom: '2026-04-15', dateTo: '2026-04-20' },
      rows: [{ date: '2026-04-15', description: 'X', amount: -1, currency: 'GBP' }],
    };
    const fetchMock = vi.fn(async (_req: FetchEnableTransactionsRequest) => internal);
    const ingestMock = vi.fn(
      (
        _account: AccountName,
        _filePath: string,
        originalName: string,
        _options: IngestCsvFileOptions,
      ): IngestResult => ({
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
        fetchEnableTransactions: fetchMock,
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

  it('prefers TrueLayer when dataAccountId + refresh token exist alongside Enable', async () => {
    getAccountConfigMock.mockImplementation((name: AccountName) =>
      name === 'barclays-current'
        ? {
            ...realGetAccountConfig('barclays-current'),
            aispFeed: {
              enableBanking: { accountId: 'eb-shadow' },
              trueLayer: { dataAccountId: 'tl-acc-xyz' },
            },
          }
        : passthrough(name),
    );
    resolveTrueLayerRefreshTokenMock.mockReturnValue('stored-refresh');

    const ebFetch = vi.fn();
    const tlFetch = vi.fn(async (_req: FetchTrueLayerTransactionsRequest): Promise<InternalFeedTransactions> => {
      const payload: InternalFeedTransactions = {
        account: 'barclays-current',
        window: { dateFrom: '2026-04-15', dateTo: '2026-04-20' },
        rows: [],
      };
      return payload;
    });

    await runFeedSync(
      'barclays-current',
      { dateFrom: '2026-04-15' },
      {
        fetchEnableTransactions: ebFetch,
        fetchTrueLayerTransactions: tlFetch,
        ingestCsvFile: vi.fn(),
        statementsDir: tmpRoot,
        today: () => '2026-04-20',
        findLatestCsvDate: () => null,
        tmpDir: () => tmpRoot,
      },
    );

    expect(ebFetch).not.toHaveBeenCalled();
    expect(tlFetch).toHaveBeenCalledOnce();
    expect(tlFetch.mock.calls[0]?.[0]).toMatchObject({
      account: 'barclays-current',
      trueLayerAccountId: 'tl-acc-xyz',
      currency: 'GBP',
    });
  });

  it('falls back to Enable when TrueLayer id exists but refresh token does not', async () => {
    getAccountConfigMock.mockImplementation((name: AccountName) =>
      name === 'barclays-current'
        ? {
            ...realGetAccountConfig('barclays-current'),
            aispFeed: {
              enableBanking: { accountId: 'eb-only' },
              trueLayer: { dataAccountId: 'token-missing-case' },
            },
          }
        : passthrough(name),
    );

    const ebFetch = vi.fn(async (): Promise<InternalFeedTransactions> => ({
      account: 'barclays-current',
      window: { dateFrom: '2026-04-15', dateTo: '2026-04-20' },
      rows: [],
    }));
    const tlFetch = vi.fn();

    await runFeedSync(
      'barclays-current',
      { dateFrom: '2026-04-15' },
      {
        fetchEnableTransactions: ebFetch,
        fetchTrueLayerTransactions: tlFetch,
        ingestCsvFile: vi.fn(),
        statementsDir: tmpRoot,
        today: () => '2026-04-20',
        findLatestCsvDate: () => null,
        tmpDir: () => tmpRoot,
      },
    );

    expect(tlFetch).not.toHaveBeenCalled();
    expect(ebFetch).toHaveBeenCalledOnce();
  });

  it('uses aispFeed.trueLayer.feedCurrency when TrueLayer wins', async () => {
    getAccountConfigMock.mockImplementation((name: AccountName) =>
      name === 'barclays-current'
        ? {
            ...realGetAccountConfig('barclays-current'),
            aispFeed: {
              trueLayer: { dataAccountId: 'tl-id', feedCurrency: 'EUR' },
            },
          }
        : passthrough(name),
    );
    resolveTrueLayerRefreshTokenMock.mockReturnValue('rt');

    const tlFetch = vi.fn(async (): Promise<InternalFeedTransactions> => {
      const payload: InternalFeedTransactions = {
        account: 'barclays-current',
        window: { dateFrom: '2026-04-15', dateTo: '2026-04-20' },
        rows: [{ date: '2026-04-15', description: 'x', amount: -1, currency: 'EUR' }],
      };
      return payload;
    });

    await runFeedSync(
      'barclays-current',
      { dateFrom: '2026-04-15' },
      {
        fetchTrueLayerTransactions: tlFetch,
        ingestCsvFile: vi.fn(
          (
            _a: AccountName,
            _fp: string,
            originalName: string,
            _o: IngestCsvFileOptions,
          ): IngestResult => ({
            ok: false,
            outcome: 'duplicate',
            originalName,
            existingPath: '/dev/null',
          }),
        ),
        statementsDir: tmpRoot,
        today: () => '2026-04-20',
        findLatestCsvDate: () => null,
        tmpDir: () => tmpRoot,
      },
    );

    expect(tlFetch).toHaveBeenCalledOnce();
    expect(tlFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'EUR',
        trueLayerAccountId: 'tl-id',
      }),
    );
  });
});

interface TrueLayerSyncOrchestrationCase {
  readonly account: AccountName;
  readonly csvMustContain: readonly string[];
  readonly transactionPathMustContain: string;
}

const TRUE_LAYER_SYNC_ORCHESTRATION_CASES: readonly TrueLayerSyncOrchestrationCase[] = [
  {
    account: 'barclays-current',
    csvMustContain: ['Number,Date,Account,Amount', '-3.50', '1200.00'],
    transactionPathMustContain: '/data/v1/accounts/',
  },
  {
    account: 'natwest',
    csvMustContain: ['Date,Type,Description,Value', '-3.50', '1200.00'],
    transactionPathMustContain: '/data/v1/accounts/',
  },
  {
    account: 'monzo-joint',
    csvMustContain: ['Money Out', 'Money In', '3.50', '1200.00'],
    transactionPathMustContain: '/data/v1/accounts/',
  },
  {
    account: 'wise-ltd',
    csvMustContain: ['Direction', ',OUT,', ',IN,'],
    transactionPathMustContain: '/data/v1/accounts/',
  },
  {
    account: 'barclaycard',
    csvMustContain: ['Merchant Name', '3.50', '-1200.00'],
    transactionPathMustContain: '/data/v1/cards/',
  },
  {
    account: 'santander-everyday',
    csvMustContain: ['Date,Card,Description,Amount', '3.50', '-1200.00'],
    transactionPathMustContain: '/data/v1/cards/',
  },
];

function makeTrueLayerSyncFetch(account: AccountName): {
  fetch: FetchLike;
  transactionUrls: string[];
} {
  const transactionUrls: string[] = [];
  let callIndex = 0;
  const useCardTransactions = isCreditCard(account);
  const responses = [
    {
      access_token: 'sync-access-token',
      refresh_token: 'sync-refresh-token',
      token_type: 'Bearer',
    },
    makeTrueLayerTransactionsEnvelope(
      useCardTransactions ? canonicalTrueLayerCardRawTransactions : canonicalTrueLayerRawTransactions,
    ),
  ];
  const fetch: FetchLike = async (input, init) => {
    const url = input instanceof URL ? input.toString() : input.toString();
    void init;
    if (url.includes('/transactions')) {
      transactionUrls.push(url);
    }
    const payload = responses[callIndex++];
    if (payload === undefined) {
      throw new Error(`TrueLayer sync fake fetch ran out of responses at ${url}`);
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    } as globalThis.Response;
  };
  return { fetch, transactionUrls };
}

function buildTrueLayerSyncFetchDeps(account: AccountName): {
  fetchTrueLayerWithFakeHttp: (
    req: FetchTrueLayerTransactionsRequest,
  ) => ReturnType<typeof fetchTrueLayerTransactions>;
  transactionUrls: string[];
} {
  const { fetch, transactionUrls } = makeTrueLayerSyncFetch(account);
  return {
    transactionUrls,
    fetchTrueLayerWithFakeHttp: (req: FetchTrueLayerTransactionsRequest) =>
      fetchTrueLayerTransactions(req, {
        fetch,
        apiBase: 'https://api.test',
        authBase: 'https://auth.test',
        getRefreshTokenSource: tokenAccount => ({
          refreshToken: 'sync-refresh-token',
          tokenAccount,
        }),
        persistRefreshToken: () => undefined,
      }),
  };
}

describe.each(TRUE_LAYER_SYNC_ORCHESTRATION_CASES)(
  'runFeedSync — TrueLayer orchestration for $account',
  syncCase => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-tl-sync-test-'));
      process.env.TRUELAYER_CLIENT_ID = 'test-client-id';
      process.env.TRUELAYER_CLIENT_SECRET = 'test-client-secret';
      resolveTrueLayerRefreshTokenMock.mockReturnValue('sync-refresh-token');
      getAccountConfigMock.mockImplementation((name: AccountName) =>
        name === syncCase.account
          ? {
              ...realGetAccountConfig(name),
              aispFeed: { trueLayer: { dataAccountId: TRUE_LAYER_ACCOUNT_ID } },
            }
          : passthrough(name),
      );
    });

    afterEach(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('fetches via TrueLayer, emits bank-shaped CSV, and skips Enable', async () => {
      const { fetchTrueLayerWithFakeHttp, transactionUrls } =
        buildTrueLayerSyncFetchDeps(syncCase.account);
      const ebFetch = vi.fn();
      const ingestMock = vi.fn(
        (
          account: AccountName,
          _filePath: string,
          originalName: string,
          _options: IngestCsvFileOptions,
        ): IngestResult => {
          return {
            ok: true,
            outcome: 'ingested',
            originalSavedAt: '/dev/null',
            finalPath: '/dev/null',
            normalizedFilename: originalName,
            renamed: false,
            partition: {
              deleted: true,
              filesCreated: [`2026-04_transactions_${account}.csv`],
              originalFile: '',
              totalRows: 2,
              rowsByMonth: new Map([['2026-04', 2]]),
            },
          };
        },
      );
      const initDbMock = vi.fn(async () => undefined);

      const result = await runFeedSync(
        syncCase.account,
        { dateFrom: '2026-04-15', force: true },
        {
          fetchEnableTransactions: ebFetch,
          fetchTrueLayerTransactions: fetchTrueLayerWithFakeHttp,
          ingestCsvFile: ingestMock,
          initDatabase: initDbMock,
          statementsDir: tmpRoot,
          today: () => '2026-04-20',
          findLatestCsvDate: () => null,
          tmpDir: () => tmpRoot,
        },
      );

      expect(ebFetch).not.toHaveBeenCalled();
      expect(ingestMock).toHaveBeenCalledOnce();
      const ingestArgs = ingestMock.mock.calls[0];
      expect(ingestArgs).toBeDefined();
      const writtenCsv = fs.readFileSync(ingestArgs![1], 'utf-8');
      const parser = PARSERS[syncCase.account];
      expect(writtenCsv.split('\n')[0]).toBe(parser.headers.join(','));
      for (const snippet of syncCase.csvMustContain) {
        expect(writtenCsv).toContain(snippet);
      }
      expect(result.csvWritten).toBe(true);
      expect(result.rowsFetched).toBe(2);
      expect(initDbMock).toHaveBeenCalledOnce();
      expect(transactionUrls.some(u => u.includes(syncCase.transactionPathMustContain))).toBe(true);
      if (syncCase.transactionPathMustContain === '/data/v1/cards/') {
        expect(transactionUrls.some(u => u.includes('/data/v1/accounts/'))).toBe(false);
      }
    });
  },
);
