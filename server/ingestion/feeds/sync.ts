/**
 * `runFeedSync` — single orchestration entry point that the HTTP route,
 * the MCP tool, and any future CLI all funnel through.
 *
 * Pipeline:
 *   1. {@link requireLinkedAccount} — read `AccountConfig.aispFeed.enableBanking.accountId`
 *      and `PARSERS[account].emitFeedTransactionsAsCsv`. Throw a typed
 *      error if either is missing so callers surface a 4xx, not a 500.
 *   2. {@link resolveWindow} — pure: intersect the requested window with
 *      what's already on disk. Skip the AISP call entirely when there is
 *      nothing new to fetch.
 *   3. `fetchEnableTransactions` (the only AISP today) — yields
 *      `InternalFeedTransactions`.
 *   4. `parser.emitFeedTransactionsAsCsv` — back to bank-shaped CSV.
 *   5. `fs.writeFileSync(os.tmpdir()/feed_<from>_<to>.csv, csv)`.
 *   6. {@link ingestCsvFile} with `overwrite: opts.force` — same function
 *      the manual upload route calls; performs validation, `_originals/`
 *      save, normalisation, partitioning. Single-month feeds may leave a
 *      `feed_*.csv` next to the canonical monthly file in `csv/`; the
 *      DB-level dedup handles this transparently.
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
import { ingestCsvFile as defaultIngestCsvFile, type IngestResult } from '../ingest-csv-file.js';
import { fetchEnableTransactions as defaultFetchEnableTransactions } from './enable-banking.js';
import type { InternalFeedTransactions } from './model.js';

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

export interface RequiredAccount {
  readonly config: AccountConfig;
  readonly parser: BankParser;
  /** UUID copied from Enable Banking after the link flow. */
  readonly enableAccountId: string;
}

/**
 * Throw early when the account isn't ready for an automated sync.
 *
 * Two failure modes — both reported as typed errors:
 *   - `'not-linked'`: `AccountConfig.aispFeed.enableBanking.accountId`
 *     has not been populated. Operator must complete the bank-link flow
 *     and copy the resulting Enable UUID into `data.ts`.
 *   - `'no-emitter'`: the parser for this account has not implemented
 *     `emitFeedTransactionsAsCsv`. Implement it (or remove the
 *     `aispFeed` slice) before retrying.
 */
export function requireLinkedAccount(account: AccountName): RequiredAccount {
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

  const enableAccountId = config.aispFeed?.enableBanking?.accountId;
  if (enableAccountId === undefined || enableAccountId.trim() === '') {
    throw new FeedSyncError(
      'not-linked',
      `Account ${account} is not linked to an Enable Banking account; set enable_account_id in data/enable-account-links.csv (or aispFeed.enableBanking.accountId in data.ts) after completing the bank-link flow`,
    );
  }

  if (parser.emitFeedTransactionsAsCsv === undefined) {
    throw new FeedSyncError(
      'no-emitter',
      `Parser for ${account} does not implement emitFeedTransactionsAsCsv; cannot synthesise CSV from feed data`,
    );
  }

  return { config, parser, enableAccountId };
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
 *   - When `latestCsvDate >= dateFrom` we advance the window's start to
 *     `latestCsvDate + 1` so we only fetch genuinely new days.
 *   - If the resulting `dateFrom` is after `dateTo`, the window is empty
 *     and `skipped: true` short-circuits the AISP call.
 */
export function resolveWindow(
  opts: { readonly dateFrom: string; readonly dateTo?: string },
  latestCsvDate: string | null,
  today: string = todayIsoLocal(),
): ResolveWindowResult {
  const dateTo = opts.dateTo ?? today;
  let effectiveDateFrom = opts.dateFrom;
  if (latestCsvDate !== null && latestCsvDate >= opts.dateFrom) {
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
}

export interface RunFeedSyncDeps {
  /** Override the AISP call (tests inject a fake to avoid real HTTP). */
  readonly fetchTransactions?: typeof defaultFetchEnableTransactions;
  /** Override the shared ingest saga (tests can isolate from the real `statements/`). */
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
  const fetchTx = deps.fetchTransactions ?? defaultFetchEnableTransactions;
  const ingest = deps.ingestCsvFile ?? defaultIngestCsvFile;
  const dbReinit = deps.initDatabase ?? defaultInitDatabase;
  const statementsDir = deps.statementsDir ?? STATEMENTS_DIR;
  const today = (deps.today ?? todayIsoLocal)();
  const tmpDirFn = deps.tmpDir ?? os.tmpdir;
  const findLatest = deps.findLatestCsvDate
    ?? ((acc: AccountName, p: BankParser) => findLatestCsvDate(acc, p, statementsDir));

  const linked = requireLinkedAccount(account);

  const latestCsvDate = findLatest(account, linked.parser);
  const window = resolveWindow(
    { dateFrom: opts.dateFrom, dateTo: opts.dateTo },
    latestCsvDate,
    today,
  );

  if (window.skipped) {
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

  const feedCurrency =
    linked.config.aispFeed?.enableBanking?.feedCurrency ?? linked.config.currency;

  const internal: InternalFeedTransactions = await fetchTx({
    account,
    enableAccountId: linked.enableAccountId,
    dateFrom: window.dateFrom,
    dateTo: window.dateTo,
    currency: feedCurrency,
  });

  // Adapter returned no rows — no CSV to write, no DB to rebuild. Skip
  // the rest of the pipeline rather than emit an empty file that would
  // pollute `_originals/` with zero-row evidence.
  if (internal.rows.length === 0) {
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

  // Bang-safe: requireLinkedAccount above already verified the emitter
  // exists, but TypeScript can't carry that proof through the `linked`
  // alias without a local guard. Call the method directly (rather than
  // detaching it into a local) so its `this` binding is preserved —
  // the emitters use `this.headers` to know which columns to write.
  if (linked.parser.emitFeedTransactionsAsCsv === undefined) {
    throw new FeedSyncError(
      'no-emitter',
      `Parser for ${account} does not implement emitFeedTransactionsAsCsv (lost between requireLinkedAccount and emit)`,
    );
  }
  const csv = linked.parser.emitFeedTransactionsAsCsv(internal);

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

  const partitionedFiles = ingestResult.outcome === 'ingested' && ingestResult.partition.deleted
    ? [...ingestResult.partition.filesCreated]
    : [];

  let initDatabaseRan = false;
  if (ingestResult.outcome === 'ingested') {
    await dbReinit();
    initDatabaseRan = true;
  }

  return {
    account,
    skipped: false,
    window: { dateFrom: window.dateFrom, dateTo: window.dateTo },
    rowsFetched: internal.rows.length,
    csvWritten: ingestResult.outcome === 'ingested',
    ingestOutcome: ingestResult.outcome,
    partitionedFiles,
    initDatabaseRan,
  };
}
