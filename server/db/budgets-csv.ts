/**
 * Canonical budgets CSV on disk (source of truth). DB is populated on startup;
 * mutating APIs rewrite this file.
 *
 * `amount`: monthly cap when `period` is `monthly` (default), or full FY cap when `period` is `yearly`.
 * Legacy CSV rows may omit `period` (defaults to monthly) or include `financial_year` (ignored).
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import type { AccountName } from '../types.js';
import { isValidAccountName } from '../types.js';
import { CATEGORY_NAMES, type CategoryName } from '../utils/categorizer.js';
import { round2 } from '../utils/math.js';

export const BUDGETS_CSV_FILENAME = 'category-budgets.csv';

export type BudgetPeriodCsv = 'monthly' | 'yearly';

export interface BudgetCsvRow {
  account: AccountName;
  category: CategoryName;
  amount: number;
  period: BudgetPeriodCsv;
}

const HEADERS = ['account', 'category', 'amount', 'period'] as const;

function ensureBudgetsDir(budgetsDir: string): void {
  if (!fs.existsSync(budgetsDir)) {
    fs.mkdirSync(budgetsDir, { recursive: true });
  }
}

export function getBudgetCsvPath(budgetsDir: string): string {
  return path.join(budgetsDir, BUDGETS_CSV_FILENAME);
}

/**
 * Read and parse budgets CSV. Missing file returns [].
 * Supports legacy headers (financial_year, account, category, amount); last row wins per account+category.
 */
export function readBudgetsFromCsvFile(csvPath: string): BudgetCsvRow[] {
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

  const merged = new Map<string, BudgetCsvRow>();

  for (const row of records) {
    const account = row.account;
    const category = row.category;
    const amountRaw = row.amount;
    if (!account || !category || amountRaw === undefined || amountRaw === '') continue;
    if (!isValidAccountName(account)) continue;
    if (!CATEGORY_NAMES.includes(category as CategoryName)) continue;
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount < 0) continue;
    const periodRaw = (row.period ?? 'monthly').toLowerCase().trim();
    const period: BudgetPeriodCsv = periodRaw === 'yearly' ? 'yearly' : 'monthly';
    const key = `${account}\t${category}`;
    merged.set(key, {
      account: account as AccountName,
      category: category as CategoryName,
      amount,
      period,
    });
  }

  return Array.from(merged.values());
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Write budgets to CSV atomically (temp file + rename).
 */
export function writeBudgetsToCsvFile(csvPath: string, rows: BudgetCsvRow[]): void {
  const dir = path.dirname(csvPath);
  ensureBudgetsDir(dir);

  const sorted = [...rows].sort((a, b) => {
    const ak = `${a.account}\t${a.category}`;
    const bk = `${b.account}\t${b.category}`;
    return ak.localeCompare(bk);
  });

  const lines = [HEADERS.join(',')];
  for (const r of sorted) {
    lines.push(
      [
        escapeCsvField(r.account),
        escapeCsvField(r.category),
        String(round2(r.amount)),
        r.period,
      ].join(','),
    );
  }
  const body = `${lines.join('\n')}\n`;
  const tmp = `${csvPath}.tmp`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, csvPath);
}

/** Ensure CSV exists with header only when directory is new. */
export function ensureBudgetCsvWithHeader(csvPath: string): void {
  if (fs.existsSync(csvPath)) return;
  const dir = path.dirname(csvPath);
  ensureBudgetsDir(dir);
  fs.writeFileSync(csvPath, `${HEADERS.join(',')}\n`, 'utf8');
}
