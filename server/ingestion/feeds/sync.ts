/**
 * `runFeedSync` — single orchestration entry point that the HTTP route,
 * the MCP tool, and any future CLI all funnel through.
 *
 * Pipeline:
 *   1. {@link requireLinkedFeed} — assert `emitFeedTransactionsAsCsv`,
 *      then pick Enable vs TrueLayer: **TrueLayer** when `dataAccountId` plus
 *      a stored refresh token exist; otherwise **Enable** when
 *      `enableBanking.accountId` is set; else `'not-linked'`.
 *   2. {@link resolveWindow} — pure: intersect the requested window with
 *      what's already on disk. Skip the AISP call entirely when there is
 *      nothing new to fetch.
 *   3. `fetchEnableTransactions` or `fetchTrueLayerTransactions` — yields
 *      `InternalFeedTransactions`.
 *   4. `parser.emitFeedTransactionsAsCsv` — back to bank-shaped CSV.
 *   5. `fs.writeFileSync(os.tmpdir()/feed_<from>_<to>.csv, csv)`.
 *   6. {@link ingestCsvFile} with `overwrite: opts.force` — same function
 *      the manual upload route calls; performs validation, `_originals/`
 *      save, normalisation, and merge into canonical monthly CSV(s) in
 *      `csv/` (no `feed_*.csv` working copies remain in `csv/`).
 *   7. `initDatabase()` once, only if anything actually landed.
 *
 * The Enable adapter, ingest function, and DB call are all dependency-
 * injectable so tests stay hermetic — the default deps point at the real
 * implementations so production code paths stay simple.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AccountConfig, AccountName } from '../../domain/accounts/index.js';
import { getAccountConfig } from '../../domain/accounts/index.js';
import { PARSERS } from '../../parsers/index.js';
import type { BankParser, CSVRow } from '../../types.js';
import { parseCSVContent } from '../../utils/csv-partitioner.js';
import { initDatabase as defaultInitDatabase } from '../../db/index.js';
import { STATEMENTS_DIR } from '../../db/connection.js';
import { shiftIsoDate, todayIsoLocal } from '../../../shared/iso-date.js';
import type { FeedSyncResponse } from '../../../shared/api-contracts.js';
import {
  ingestCsvFile as defaultIngestCsvFile,
  durableRelPathsAfterCsvIngest,
  type IngestResult,
} from '../ingest-csv-file.js';
import { clearReadResponseCache } from '../../http/read-response-cache.js';
import type { FeedSyncRunLogger } from './feed-sync-event-log.js';
import { fetchEnableTransactions as defaultFetchEnableTransactions } from './enable-banking.js';
import { fetchTrueLayerTransactions as defaultFetchTrueLayerTransactions } from './truelayer/truelayer-transactions.js';
import { TrueLayerError } from './truelayer/truelayer-error.js';
import {
  removeTrueLayerRefreshToken,
  resolveTrueLayerRefreshToken,
} from './truelayer/truelayer-tokens.js';
import type { InternalFeedTransactions } from './model.js';
import { uploadDurableRelPathsToS3 } from '../../storage/s3-durable-sync.js';

/** Strongly typed error so the route + MCP tool emit clear 4xx messages. */
export class FeedSyncError extends Error {
  constructor(
    public readonly code:
      | 'not-linked'
      | 'no-emitter'
      | 'unknown-account',
    message: string,
  ) {
    super(message);
    this.name = 'FeedSyncError';
  }
}

export interface LinkedFeed {
  readonly config: AccountConfig;
  readonly parser: BankParser;
  readonly feedCurrency: string;
  readonly provider: 'truelayer' | 'enable';
  readonly enable?: { readonly enableAccountId: string };
  readonly trueLayer?: { readonly dataAccountId: string };
}

/**
 * Throw early when the account isn't ready for an automated sync — or resolve
 * the active AISP adapter + book / feed currency.
 *
 * **`not-linked`** when neither TrueLayer (`dataAccountId` + refresh token)
 * nor Enable (`accountId`) is sufficiently configured.
 */
export function requireLinkedFeed(account: AccountName): LinkedFeed {
  let config: AccountConfig;
  try {
    config = getAccountConfig(account);
  } catch {
    throw new FeedSyncError('unknown-account', `Unknown account: ${account}`);
  }

  const parser = PARSERS[account];
  if (parser === undefined) {
    throw new FeedSyncError('unknown-account', `No parser configured for account: ${account}`);
  }

  if (parser.emitFeedTransactionsAsCsv === undefined) {
    throw new FeedSyncError(
      'no-emitter',
      `Parser for ${account} does not implement emitFeedTransactionsAsCsv; cannot synthesise CSV from feed data`,
    );
  }

  const enableAccountIdRaw = config.aispFeed?.enableBanking?.accountId;
  const enableAccountId = enableAccountIdRaw?.trim() ?? '';

  const dataAccountIdRaw = config.aispFeed?.trueLayer?.dataAccountId;
  const dataAccountId = dataAccountIdRaw?.trim() ?? '';

  const refreshTokenRow = resolveTrueLayerRefreshToken(account);
  const hasTlRefresh = refreshTokenRow !== undefined && refreshTokenRow.trim() !== '';

  const ebReady = enableAccountId !== '';
  const tlReady = dataAccountId !== '' && hasTlRefresh;

  const feedCurrencyFromEb = config.aispFeed?.enableBanking?.feedCurrency;
  const feedCurrencyFromTl = config.aispFeed?.trueLayer?.feedCurrency;

  if (tlReady) {
    if (parser.mapTrueLayerTransaction === undefined) {
      throw new FeedSyncError(
        'no-emitter',
        `Parser for ${account} does not implement mapTrueLayerTransaction; cannot map TrueLayer feed rows`,
      );
    }
    return {
      config,
      parser,
      provider: 'truelayer',
      feedCurrency:
        feedCurrencyFromTl ?? feedCurrencyFromEb ?? config.currency,
      trueLayer: { dataAccountId },
    };
  }

  if (ebReady) {
    return {
      config,
      parser,
      provider: 'enable',
      feedCurrency: feedCurrencyFromEb ?? config.currency,
      enable: { enableAccountId },
    };
  }

  throw new FeedSyncError(
    'not-linked',
    `Account ${account} is not linked for feed sync — either: (Enable) set enable_account_id in data/enable-account-links.csv (or aispFeed.enableBanking.accountId) after bank consent; or (TrueLayer) POST /api/feed/truelayer/start then set trueLayer_account_id in data/truelayer-account-links.csv (or aispFeed.trueLayer.dataAccountId) so it matches TrueLayer Console`,
  );
}


export interface ResolveWindowResult {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly skipped: boolean;
  readonly reason?: 'already_up_to_date';
}

/**
 * Pure window resolver — never reads the filesystem, never invents
 * `dateFrom`. Callers compute `latestCsvDate` separately so this stays
 * trivially testable.
 *
 * Rules:
 *   - `dateTo` defaults to `today` when omitted.
 *   - **Incremental** (no `lookbackDays`): when `latestCsvDate >= dateFrom`
 *     advance start to `latestCsvDate + 1`.
 *   - **Lookback** (`lookbackDays` set): `effectiveDateFrom = max(dateFrom,
 *     dateTo - (lookbackDays - 1))` inclusive; do not bump past latest CSV.
 *   - If the resulting `dateFrom` is after `dateTo`, `skipped: true`.
 */
export interface ResolveWindowOpts {
  readonly dateFrom: string;
  readonly dateTo?: string;
  readonly lookbackDays?: number;
}

export function resolveWindow(
  opts: ResolveWindowOpts,
  latestCsvDate: string | null,
  today: string = todayIsoLocal(),
): ResolveWindowResult {
  const dateTo = opts.dateTo ?? today;
  let effectiveDateFrom = opts.dateFrom;

  if (opts.lookbackDays !== undefined && opts.lookbackDays >= 1) {
    const refreshFrom = shiftIsoDate(dateTo, -(opts.lookbackDays - 1));
    effectiveDateFrom = effectiveDateFrom > refreshFrom ? effectiveDateFrom : refreshFrom;
  } else if (latestCsvDate !== null && latestCsvDate >= opts.dateFrom) {
    effectiveDateFrom = shiftIsoDate(latestCsvDate, 1);
  }

  if (effectiveDateFrom > dateTo) {
    return {
      dateFrom: effectiveDateFrom,
      dateTo,
      skipped: true,
      reason: 'already_up_to_date',
    };
  }
  return { dateFrom: effectiveDateFrom, dateTo, skipped: false };
}

/**
 * Walk `statements/{account}/csv/` and return the latest transaction
 * date the parser can identify across the most-recent monthly file.
 *
 * Reads only the most-recent `YYYY-MM_transactions_*.csv` (sorted
 * lexicographically — the `YYYY-MM` prefix means lex order matches
 * chronological order). Mid-month accuracy matters for skip semantics:
 * if the latest CSV covers May 1–15 and the request is `dateFrom=May 10`,
 * we should still fetch May 16+ rather than skip the whole window.
 */
export function findLatestCsvDate(
  account: AccountName,
  parser: BankParser,
  statementsDir: string = STATEMENTS_DIR,
): string | null {
  const csvDir = path.join(statementsDir, account, 'csv');
  if (!fs.existsSync(csvDir)) return null;

  const monthlyFiles = fs.readdirSync(csvDir)
    .filter(f => /^\d{4}-\d{2}_transactions_/.test(f))
    .sort();
  if (monthlyFiles.length === 0) return null;

  const latestFile = monthlyFiles[monthlyFiles.length - 1];
  let content: string;
  try {
    content = fs.readFileSync(path.join(csvDir, latestFile), 'utf-8');
  } catch {
    return null;
  }
  const preprocessed = parser.preprocess(content);
  let rows: CSVRow[];
  try {
    rows = parseCSVContent(preprocessed);
  } catch {
    return null;
  }

  let maxIso: string | null = null;
  for (const row of rows) {
    const raw = row[parser.dateColumn];
    if (raw === undefined || raw === '') continue;
    const dt = parser.parseDate(raw);
    if (dt === null) continue;
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    if (maxIso === null || iso > maxIso) maxIso = iso;
  }
  return maxIso;
}

export interface RunFeedSyncOptions {
  readonly dateFrom: string;
  readonly dateTo?: string;
  readonly force?: boolean;
  readonly lookbackDays?: number;
  /** When true, skip per-account DB rebuild (sync-all batches one rebuild at end). */
  readonly deferDbReinit?: boolean;
}

export interface RunFeedSyncDeps {
  /** Override the Enable Banking adapter (tests inject a fake). */
  readonly fetchEnableTransactions?: typeof defaultFetchEnableTransactions;
  /** Override TrueLayer fetching (parallel to Enable). */
  readonly fetchTrueLayerTransactions?: typeof defaultFetchTrueLayerTransactions;
    /** Override the shared ingest workflow (tests can isolate from the real `statements/`). */
  readonly ingestCsvFile?: typeof defaultIngestCsvFile;
  /** Override the DB rebuild (tests skip the heavy reload). */
  readonly initDatabase?: () => Promise<void>;
  /** Override the canonical statements directory. */
  readonly statementsDir?: string;
  /** Override `today` (tests pin time). */
  readonly today?: () => string;
  /** Override the latest-csv-date scan (tests pre-seed without writing CSVs). */
  readonly findLatestCsvDate?: (account: AccountName, parser: BankParser) => string | null;
  /** Override the temp-dir factory (tests redirect to a temp folder they own). */
  readonly tmpDir?: () => string;
  /** Operational event logger (sync-all runs only). */
  readonly runLogger?: FeedSyncRunLogger;
}

/**
 * Drive a single account's feed sync end-to-end. Returns a structured
 * result the route + MCP tool send back verbatim (after Zod parse).
 */
export async function runFeedSync(
  account: AccountName,
  opts: RunFeedSyncOptions,
  deps: RunFeedSyncDeps = {},
): Promise<FeedSyncResponse> {
  const fetchEnable = deps.fetchEnableTransactions ?? defaultFetchEnableTransactions;
  const fetchTrueLayer =
    deps.fetchTrueLayerTransactions ?? defaultFetchTrueLayerTransactions;
  const ingest = deps.ingestCsvFile ?? defaultIngestCsvFile;
  const dbReinit = deps.initDatabase ?? defaultInitDatabase;
  const statementsDir = deps.statementsDir ?? STATEMENTS_DIR;
  const today = (deps.today ?? todayIsoLocal)();
  const tmpDirFn = deps.tmpDir ?? os.tmpdir;
  const findLatest = deps.findLatestCsvDate
    ?? ((acc: AccountName, p: BankParser) => findLatestCsvDate(acc, p, statementsDir));
  const runLogger = deps.runLogger;

  const linked = requireLinkedFeed(account);

  const latestCsvDate = findLatest(account, linked.parser);
  const window = resolveWindow(
    {
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      lookbackDays: opts.lookbackDays,
    },
    latestCsvDate,
    today,
  );

  if (window.skipped) {
    runLogger?.logEvent({
      kind: 'window',
      level: 'info',
      message: `Window skipped: ${window.reason ?? 'already_up_to_date'}`,
      account,
      provider: linked.provider,
      detail: {
        dateFrom: window.dateFrom,
        dateTo: window.dateTo,
        skipped: true,
      },
    });
    return {
      account,
      skipped: true,
      reason: window.reason,
      window: { dateFrom: window.dateFrom, dateTo: window.dateTo },
      rowsFetched: 0,
      csvWritten: false,
      partitionedFiles: [],
      initDatabaseRan: false,
    };
  }

  runLogger?.logEvent({
    kind: 'window',
    level: 'info',
    message: `Fetch window ${window.dateFrom} → ${window.dateTo}`,
    account,
    provider: linked.provider,
    detail: {
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      skipped: false,
    },
  });

  const feedCurrency = linked.feedCurrency;

  let internal: InternalFeedTransactions;
  if (linked.provider === 'truelayer' && linked.trueLayer !== undefined) {
    try {
      internal = await fetchTrueLayer({
        account,
        trueLayerAccountId: linked.trueLayer.dataAccountId,
        dateFrom: window.dateFrom,
        dateTo: window.dateTo,
        currency: feedCurrency,
      }, {
        bypassCache: opts.force === true,
      });
    } catch (err) {
      if (
        err instanceof TrueLayerError &&
        (err.code === 'sca-exceeded' || err.code === 'expired-session')
      ) {
        removeTrueLayerRefreshToken(account);
      }
      throw err;
    }
  } else if (linked.provider === 'enable' && linked.enable !== undefined) {
    internal = await fetchEnable({
      account,
      enableAccountId: linked.enable.enableAccountId,
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      currency: feedCurrency,
    });
  } else {
    throw new FeedSyncError(
      'not-linked',
      `Account ${account}: internal routing error — no AISP adapter selected`,
    );
  }

  // Adapter returned no rows — no CSV to write, no DB to rebuild. Skip
  // the rest of the pipeline rather than emit an empty file that would
  // pollute `_originals/` with zero-row evidence.
  if (internal.rows.length === 0) {
    runLogger?.logEvent({
      kind: 'fetch_ok',
      level: 'info',
      message: 'Bank returned no transactions in window',
      account,
      provider: linked.provider,
      detail: { rowsFetched: 0 },
    });
    return {
      account,
      skipped: false,
      window: { dateFrom: window.dateFrom, dateTo: window.dateTo },
      rowsFetched: 0,
      csvWritten: false,
      partitionedFiles: [],
      initDatabaseRan: false,
    };
  }

  // Bang-safe: requireLinkedFeed above already verified the emitter
  // exists, but TypeScript can't carry that proof through the `linked`
  // alias without a local guard. Call the method directly (rather than
  // detaching it into a local) so its `this` binding is preserved —
  // the emitters use `this.headers` to know which columns to write.
  if (linked.parser.emitFeedTransactionsAsCsv === undefined) {
    throw new FeedSyncError(
      'no-emitter',
      `Parser for ${account} does not implement emitFeedTransactionsAsCsv (lost between requireLinkedFeed and emit)`,
    );
  }
  const csv = linked.parser.emitFeedTransactionsAsCsv(internal);

  runLogger?.logEvent({
    kind: 'fetch_ok',
    level: 'info',
    message: `Fetched ${String(internal.rows.length)} transaction(s) from ${linked.provider}`,
    account,
    provider: linked.provider,
    detail: {
      rowsFetched: internal.rows.length,
      ...(internal.trueLayerFetchSource !== undefined
        ? { trueLayerFetchSource: internal.trueLayerFetchSource }
        : {}),
    },
  });

  const fileName = `feed_${window.dateFrom}_${window.dateTo}.csv`;
  const tmpPath = path.join(tmpDirFn(), fileName);
  fs.writeFileSync(tmpPath, csv, 'utf-8');

  const ingestResult: IngestResult = ingest(
    account,
    tmpPath,
    fileName,
    { overwrite: opts.force === true },
    statementsDir,
  );

  if (ingestResult.outcome === 'duplicate') {
    runLogger?.logEvent({
      kind: 'ingest',
      level: 'warn',
      message: `Duplicate CSV — matches existing original ${ingestResult.originalName}`,
      account,
      provider: linked.provider,
      detail: {
        outcome: 'duplicate',
        originalName: ingestResult.originalName,
        existingPath: ingestResult.existingPath,
        rowsFetched: internal.rows.length,
      },
    });
  } else if (ingestResult.outcome === 'invalid') {
    runLogger?.logEvent({
      kind: 'ingest',
      level: 'error',
      message: 'CSV failed validation during ingest',
      account,
      provider: linked.provider,
      detail: {
        outcome: 'invalid',
        errorCount: ingestResult.errors.length,
      },
    });
  } else if (ingestResult.outcome === 'ingested') {
    runLogger?.logEvent({
      kind: 'ingest',
      level: 'info',
      message: 'CSV ingested and database refreshed',
      account,
      provider: linked.provider,
      detail: {
        outcome: 'ingested',
        rowsFetched: internal.rows.length,
        initDatabaseRan: opts.deferDbReinit !== true,
      },
    });
  }

  const partitionedFiles = ingestResult.outcome === 'ingested' && ingestResult.partition.deleted
    ? [...ingestResult.partition.filesCreated]
    : [];

  let initDatabaseRan = false;
  if (ingestResult.outcome === 'ingested') {
    clearReadResponseCache();
    if (opts.deferDbReinit !== true) {
      await dbReinit();
      initDatabaseRan = true;
    }
    const canonicalStatements =
      path.resolve(statementsDir) === path.resolve(STATEMENTS_DIR);
    if (canonicalStatements) {
      const rels = durableRelPathsAfterCsvIngest(account, ingestResult);
      const uploadPaths =
        opts.deferDbReinit === true ? rels : [...rels, 'data/manifest.json'];
      try {
        await uploadDurableRelPathsToS3(uploadPaths, 'feed-sync');
      } catch (err) {
        console.error('[FeedSync] S3 durable upload failed:', err);
      }
    }
  }

  const duplicateFields =
    ingestResult.outcome === 'duplicate'
      ? {
          duplicateOriginalName: ingestResult.originalName,
          duplicateExistingPath: ingestResult.existingPath,
        }
      : {};

  return {
    account,
    skipped: false,
    window: { dateFrom: window.dateFrom, dateTo: window.dateTo },
    rowsFetched: internal.rows.length,
    csvWritten: ingestResult.outcome === 'ingested',
    ingestOutcome: ingestResult.outcome,
    partitionedFiles,
    initDatabaseRan,
    ...duplicateFields,
  };
}
