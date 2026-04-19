/**
 * Canonical debts CSV on disk (source of truth). DB is populated on startup;
 * mutating APIs rewrite this file. Debts are external creditors we don't have
 * statement feeds for, matched against our real-account transactions by
 * merchant substring.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import type { AccountName } from '../types.js';
import { isValidAccountName } from '../types.js';
import { round2 } from '../utils/math.js';
import { escapeCsvField, atomicWriteCsv } from '../utils/csv-helpers.js';

export const DEBTS_CSV_FILENAME = 'debts.csv';

export interface DebtCsvRow {
  id: string;
  name: string;
  merchantPattern: string;
  sourceAccounts: readonly AccountName[];
  originalLoanAmount: number;
  originalLoanDate: string | null;
  openingBalance: number;
  openingBalanceDate: string;
  archived: boolean;
}

const HEADERS = [
  'id',
  'name',
  'merchant_pattern',
  'source_accounts',
  'original_loan_amount',
  'original_loan_date',
  'opening_balance',
  'opening_balance_date',
  'archived',
] as const;

/**
 * First-boot defaults. Written only when `debts/debts.csv` is missing.
 * User edits via the UI (or hand-edits) are never overwritten.
 */
export const DEFAULT_DEBT_ROWS: readonly DebtCsvRow[] = [
  {
    id: 'funding-circle',
    name: 'Funding Circle',
    merchantPattern: 'FUNDING CIRCLE',
    sourceAccounts: ['barclays-current'],
    originalLoanAmount: 18700.0,
    originalLoanDate: '2023-11-09',
    openingBalance: 13138.71,
    openingBalanceDate: '2026-04-19',
    archived: false,
  },
  {
    id: 'bounce-back-loan',
    name: 'Bounce Back Loan',
    merchantPattern: '0520A',
    sourceAccounts: ['barclays-current'],
    originalLoanAmount: 50000.0,
    originalLoanDate: null,
    openingBalance: 22685.36,
    openingBalanceDate: '2026-04-19',
    archived: false,
  },
  {
    id: 'novuna',
    name: 'Novuna Finance',
    merchantPattern: 'NOVUNA',
    sourceAccounts: ['natwest'],
    originalLoanAmount: 13228.0,
    originalLoanDate: null,
    openingBalance: 5518.23,
    openingBalanceDate: '2026-04-19',
    archived: false,
  },
] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function getDebtsCsvPath(debtsDir: string): string {
  return path.join(debtsDir, DEBTS_CSV_FILENAME);
}

function parseSourceAccounts(raw: string): AccountName[] | null {
  const tokens = raw
    .split(';')
    .map(t => t.trim())
    .filter(t => t.length > 0);
  if (tokens.length === 0) return null;
  const out: AccountName[] = [];
  for (const t of tokens) {
    if (!isValidAccountName(t)) return null;
    out.push(t);
  }
  return out;
}

function serializeSourceAccounts(accounts: readonly AccountName[]): string {
  return accounts.join(';');
}

/**
 * Read and parse debts CSV. Missing file returns [].
 * Invalid rows are skipped (with a console warning) rather than aborting the load.
 * Duplicate ids: last row wins (matches budgets-csv behaviour).
 */
export function readDebtsFromCsvFile(csvPath: string): DebtCsvRow[] {
  if (!fs.existsSync(csvPath)) {
    return [];
  }
  const content = fs.readFileSync(csvPath, 'utf8').trim();
  if (content === '') {
    return [];
  }

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const merged = new Map<string, DebtCsvRow>();

  for (const row of records) {
    const id = (row.id ?? '').trim();
    const name = (row.name ?? '').trim();
    const merchantPattern = (row.merchant_pattern ?? '').trim();
    const sourceAccountsRaw = (row.source_accounts ?? '').trim();
    const originalLoanAmountRaw = (row.original_loan_amount ?? '').trim();
    const originalLoanDateRaw = (row.original_loan_date ?? '').trim();
    const openingBalanceRaw = (row.opening_balance ?? '').trim();
    const openingBalanceDateRaw = (row.opening_balance_date ?? '').trim();
    const archivedRaw = (row.archived ?? '').trim().toLowerCase();

    if (!id || !name || !merchantPattern) {
      console.warn(`[debts-csv] Dropping row with missing id/name/pattern: ${JSON.stringify(row)}`);
      continue;
    }

    const sourceAccounts = parseSourceAccounts(sourceAccountsRaw);
    if (!sourceAccounts) {
      console.warn(`[debts-csv] Dropping row ${id} with invalid source_accounts: "${sourceAccountsRaw}"`);
      continue;
    }

    const originalLoanAmount = Number(originalLoanAmountRaw);
    if (!Number.isFinite(originalLoanAmount) || originalLoanAmount <= 0) {
      console.warn(`[debts-csv] Dropping row ${id} with invalid original_loan_amount: "${originalLoanAmountRaw}"`);
      continue;
    }

    const openingBalance = Number(openingBalanceRaw);
    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
      console.warn(`[debts-csv] Dropping row ${id} with invalid opening_balance: "${openingBalanceRaw}"`);
      continue;
    }

    if (!ISO_DATE_RE.test(openingBalanceDateRaw)) {
      console.warn(`[debts-csv] Dropping row ${id} with invalid opening_balance_date: "${openingBalanceDateRaw}"`);
      continue;
    }

    const originalLoanDate =
      originalLoanDateRaw === ''
        ? null
        : ISO_DATE_RE.test(originalLoanDateRaw)
          ? originalLoanDateRaw
          : null;
    if (originalLoanDateRaw !== '' && originalLoanDate === null) {
      console.warn(`[debts-csv] Row ${id} had invalid original_loan_date "${originalLoanDateRaw}"; storing as null`);
    }

    const archived = archivedRaw === 'true' || archivedRaw === '1' || archivedRaw === 'yes';

    merged.set(id, {
      id,
      name,
      merchantPattern,
      sourceAccounts,
      originalLoanAmount,
      originalLoanDate,
      openingBalance,
      openingBalanceDate: openingBalanceDateRaw,
      archived,
    });
  }

  return Array.from(merged.values());
}

/**
 * Write debts to CSV atomically (temp file + rename). Rows are sorted by id
 * for stable diffs.
 */
export function writeDebtsToCsvFile(csvPath: string, rows: readonly DebtCsvRow[]): void {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));

  const lines = [HEADERS.join(',')];
  for (const r of sorted) {
    lines.push(
      [
        escapeCsvField(r.id),
        escapeCsvField(r.name),
        escapeCsvField(r.merchantPattern),
        escapeCsvField(serializeSourceAccounts(r.sourceAccounts)),
        String(round2(r.originalLoanAmount)),
        r.originalLoanDate ?? '',
        String(round2(r.openingBalance)),
        r.openingBalanceDate,
        r.archived ? 'true' : '',
      ].join(','),
    );
  }
  const body = `${lines.join('\n')}\n`;
  atomicWriteCsv(csvPath, body);
}

/**
 * First-boot seeding: if the CSV is missing, write header + default rows.
 * If the file already exists (even empty), leave it alone — user edits win.
 */
export function ensureDebtsCsvWithDefaults(csvPath: string): void {
  if (fs.existsSync(csvPath)) return;
  writeDebtsToCsvFile(csvPath, DEFAULT_DEBT_ROWS);
}
