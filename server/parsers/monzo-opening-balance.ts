/**
 * Derive Monzo opening balance anchor from export `Balance` column when present.
 */
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import type { AccountName } from '../../shared/api-contracts.js';
import {
  ensureOpeningBalancesCsvExists,
  readOpeningBalancesFromCsv,
  writeOpeningBalancesCsv,
  type OpeningBalanceRow,
} from '../db/opening-balances-csv.js';
import {
  formatMonzoIsoDate,
  getMonzoColumnValue,
  parseMonzoDateInternal,
  parseMonzoAmount,
  parseMonzoSignedAmount,
} from './monzo.js';
import type { CSVRow } from '../types.js';

export interface MonzoOpeningAnchor {
  readonly openingBalance: number;
  readonly openingBalanceDate: string;
  readonly lastBalance: number;
  readonly lastBalanceDate: string;
}

function hasBalanceColumn(headers: readonly string[]): boolean {
  return headers.some(h => h.trim().toLowerCase() === 'balance');
}

function sortMonzoRows(rows: readonly CSVRow[]): CSVRow[] {
  return [...rows].sort((a, b) => {
    const dateA = parseMonzoDateInternal(getMonzoColumnValue(a, 'Date'));
    const dateB = parseMonzoDateInternal(getMonzoColumnValue(b, 'Date'));
    if (!dateA || !dateB) return 0;
    const dateCmp = dateA.getTime() - dateB.getTime();
    if (dateCmp !== 0) return dateCmp;
    const timeA = getMonzoColumnValue(a, 'Time');
    const timeB = getMonzoColumnValue(b, 'Time');
    return timeA.localeCompare(timeB);
  });
}

/** Compute opening anchor and last running balance from Monzo CSV content. */
export function deriveMonzoOpeningAnchorFromCsvContent(content: string): MonzoOpeningAnchor | null {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as CSVRow[];

  if (records.length === 0) return null;

  const headers = Object.keys(records[0] ?? {});
  if (!hasBalanceColumn(headers)) return null;

  const sorted = sortMonzoRows(records);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return null;

  const firstDate = parseMonzoDateInternal(getMonzoColumnValue(first, 'Date'));
  const lastDate = parseMonzoDateInternal(getMonzoColumnValue(last, 'Date'));
  if (!firstDate || !lastDate) return null;

  const firstAmount = parseMonzoSignedAmount(first);
  const firstBalance = parseMonzoAmount(getMonzoColumnValue(first, 'Balance'));
  const lastBalance = parseMonzoAmount(getMonzoColumnValue(last, 'Balance'));

  return {
    openingBalance: firstBalance - firstAmount,
    openingBalanceDate: formatMonzoIsoDate(firstDate),
    lastBalance,
    lastBalanceDate: formatMonzoIsoDate(lastDate),
  };
}

function userHasManualOpening(row: OpeningBalanceRow | undefined): boolean {
  if (row === undefined) return false;
  if (row.openingBalanceDate !== null && row.openingBalanceDate !== '') return true;
  return row.openingBalance !== 0;
}

/**
 * When a Monzo export includes running balances, persist an opening anchor to
 * `data/opening-balances.csv` if the user has not already configured one.
 */
export function maybeApplyMonzoOpeningBalanceFromCsvFile(
  account: AccountName,
  csvFilePath: string,
): MonzoOpeningAnchor | null {
  if (account !== 'monzo-joint') return null;
  if (!fs.existsSync(csvFilePath)) return null;

  ensureOpeningBalancesCsvExists();
  const existing = readOpeningBalancesFromCsv().find(r => r.account === account);
  if (userHasManualOpening(existing)) return null;

  const content = fs.readFileSync(csvFilePath, 'utf-8');
  const anchor = deriveMonzoOpeningAnchorFromCsvContent(content);
  if (anchor === null) return null;

  const current = readOpeningBalancesFromCsv();
  const next = current.filter(r => r.account !== account);
  next.push({
    account,
    openingBalance: anchor.openingBalance,
    openingBalanceDate: anchor.openingBalanceDate,
  });
  writeOpeningBalancesCsv(next);
  return anchor;
}
