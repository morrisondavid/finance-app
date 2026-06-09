/**
 * CSV source of truth for `account_balances` opening anchors (`data/opening-balances.csv`).
 */
import fs from 'fs';
import path from 'path';
import type { Database } from 'better-sqlite3';
import { REPO_ROOT } from '../repo-root.js';
import type { AccountName } from '../../shared/api-contracts.js';
import { AccountNameSchema } from '../../shared/api-contracts.js';
import { escapeCsvField } from '../utils/csv-helpers.js';
import { createCsvDecoders, readCsvRecords } from '../utils/csv-decoders.js';
import { recomputeAndPersistDataManifest } from '../data-manifest.js';
import { writeDurableFileSync } from '../storage/durable-fs.js';

/**
 * Default path: `data/opening-balances.csv`. Tests may set
 * `BANK_STATEMENTS_OPENING_BALANCES_CSV` to an absolute path or path
 * relative to the repo root.
 */
export function getOpeningBalancesCsvPath(): string {
  const fromEnv = process.env.BANK_STATEMENTS_OPENING_BALANCES_CSV?.trim();
  if (fromEnv !== undefined && fromEnv !== '') {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(REPO_ROOT, fromEnv);
  }
  return path.join(REPO_ROOT, 'data', 'opening-balances.csv');
}

/** @deprecated Prefer {@link getOpeningBalancesCsvPath} (honours test env). */
export const OPENING_BALANCES_CSV = path.join(REPO_ROOT, 'data', 'opening-balances.csv');

const decoders = createCsvDecoders('OpeningBalance');
const { requireNonEmpty, decodeNullableIsoDate, decodeNumber } = decoders;

export const OPENING_BALANCES_HEADERS = ['account', 'opening_balance', 'opening_balance_date'] as const;

export interface OpeningBalanceRow {
  readonly account: AccountName;
  readonly openingBalance: number;
  readonly openingBalanceDate: string | null;
}

/** Matches prior hard-coded `initSchema` seed — written when CSV is first created. */
const DEFAULT_ROWS: readonly OpeningBalanceRow[] = [
  { account: 'capital-on-tap', openingBalance: 30000, openingBalanceDate: '2023-01-01' },
  { account: 'barclaycard', openingBalance: 9100, openingBalanceDate: '2023-07-01' },
  { account: 'barclays-current', openingBalance: 63035.54, openingBalanceDate: '2022-04-19' },
  /**
   * Barclays Savings tax-reserve account — £0 on 2024-01-01 per bank statement.
   * Ledger must include all movements from that date (not only a partial export).
   */
  { account: 'barclays-savings', openingBalance: 0, openingBalanceDate: '2024-01-01' },
  { account: 'natwest', openingBalance: 3256.79, openingBalanceDate: '2021-01-03' },
  { account: 'natwest-savings', openingBalance: 0.32, openingBalanceDate: '2025-06-12' },
  { account: 'emirates-islamic', openingBalance: 0, openingBalanceDate: '2026-02-22' },
  { account: 'emirates-islamic-gbp', openingBalance: 0, openingBalanceDate: '2026-05-20' },
  { account: 'emirates-islamic-usd', openingBalance: 0, openingBalanceDate: null },
  { account: 'santander-everyday', openingBalance: 0, openingBalanceDate: '2025-03-19' },
  { account: 'mbna', openingBalance: 10000, openingBalanceDate: null },
];

function csvCell(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function parseRow(raw: Record<string, string>): OpeningBalanceRow {
  const wide = raw as Record<string, unknown>;
  const rowHint = (csvCell(wide, 'account') ?? '').trim() || '?';
  const account = AccountNameSchema.parse(requireNonEmpty(csvCell(wide, 'account'), 'account', rowHint));
  const openingBalance = decodeNumber(csvCell(wide, 'opening_balance'), 'opening_balance', rowHint);
  const openingBalanceDate = decodeNullableIsoDate(
    csvCell(wide, 'opening_balance_date'),
    'opening_balance_date',
    rowHint,
  );
  return { account, openingBalance, openingBalanceDate };
}

export function readOpeningBalancesFromCsv(
  csvPath: string = getOpeningBalancesCsvPath(),
): OpeningBalanceRow[] {
  if (!fs.existsSync(csvPath)) return [];
  const rawRows = readCsvRecords(csvPath);
  return rawRows.map(parseRow);
}

export function writeOpeningBalancesCsv(
  rows: readonly OpeningBalanceRow[],
  csvPath: string = getOpeningBalancesCsvPath(),
): void {
  const dir = path.dirname(csvPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const lines: string[] = [[...OPENING_BALANCES_HEADERS].join(',')];
  const sorted = [...rows].sort((a, b) => a.account.localeCompare(b.account));
  for (const r of sorted) {
    const date = r.openingBalanceDate ?? '';
    lines.push(
      [
        escapeCsvField(r.account),
        escapeCsvField(String(r.openingBalance)),
        escapeCsvField(date),
      ].join(','),
    );
  }
  writeDurableFileSync(csvPath, `${lines.join('\n')}\n`);
}

export function ensureOpeningBalancesCsvExists(): OpeningBalanceRow[] {
  const p = getOpeningBalancesCsvPath();
  if (!fs.existsSync(p)) {
    writeOpeningBalancesCsv(DEFAULT_ROWS, p);
    return [...DEFAULT_ROWS];
  }
  const current = readOpeningBalancesFromCsv(p);
  const present = new Set(current.map(r => r.account));
  const missing = DEFAULT_ROWS.filter(r => !present.has(r.account));
  if (missing.length === 0) {
    return current;
  }
  const merged = [...current, ...missing];
  writeOpeningBalancesCsv(merged, p);
  return merged;
}

/**
 * Upsert rows into `account_balances` from CSV (after table exists).
 */
export function applyOpeningBalancesToDb(db: Database, rows: readonly OpeningBalanceRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO account_balances (account, opening_balance, opening_balance_date, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(account) DO UPDATE SET
      opening_balance = excluded.opening_balance,
      opening_balance_date = excluded.opening_balance_date,
      updated_at = CURRENT_TIMESTAMP
  `);
  for (const r of rows) {
    stmt.run(r.account, r.openingBalance, r.openingBalanceDate);
  }
}

/**
 * Replace CSV from current DB rows (all known accounts in table).
 */
export function snapshotOpeningBalancesFromDb(db: Database): void {
  const rows = db
    .prepare(
      `SELECT account, opening_balance, opening_balance_date FROM account_balances ORDER BY account`,
    )
    .all() as Array<{
      account: string;
      opening_balance: number;
      opening_balance_date: string | null;
    }>;
  const parsed: OpeningBalanceRow[] = rows.map(r =>
    parseRow({
      account: r.account,
      opening_balance: String(r.opening_balance),
      opening_balance_date: r.opening_balance_date ?? '',
    }),
  );
  writeOpeningBalancesCsv(parsed, getOpeningBalancesCsvPath());
}

export function upsertOpeningBalanceRowAndPersist(
  account: AccountName,
  openingBalance: number,
  openingBalanceDate: string | null | undefined,
  db: Database,
): void {
  ensureOpeningBalancesCsvExists();
  const current = readOpeningBalancesFromCsv();
  const next = current.filter(r => r.account !== account);
  next.push({
    account,
    openingBalance,
    openingBalanceDate: openingBalanceDate ?? null,
  });
  writeOpeningBalancesCsv(next);
  db.prepare(`
    INSERT INTO account_balances (account, opening_balance, opening_balance_date, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(account) DO UPDATE SET
      opening_balance = excluded.opening_balance,
      opening_balance_date = excluded.opening_balance_date,
      updated_at = CURRENT_TIMESTAMP
  `).run(account, openingBalance, openingBalanceDate ?? null);
  recomputeAndPersistDataManifest();
}
