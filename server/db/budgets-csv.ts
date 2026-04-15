/**
 * Canonical budgets CSV on disk (source of truth). DB is populated on startup;
 * mutating APIs rewrite this file.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import type { AccountName } from '../types.js';
import { isValidAccountName } from '../types.js';
import { CATEGORY_NAMES, type CategoryName } from '../utils/categorizer.js';

export const BUDGETS_CSV_FILENAME = 'category-budgets.csv';

export interface BudgetCsvRow {
  financialYear: string;
  account: AccountName;
  category: CategoryName;
  amount: number;
}

const HEADERS = ['financial_year', 'account', 'category', 'amount'] as const;

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

  const out: BudgetCsvRow[] = [];
  for (const row of records) {
    const fy = row.financial_year ?? row['financial year'];
    const account = row.account;
    const category = row.category;
    const amountRaw = row.amount;
    if (!fy || !account || !category || amountRaw === undefined || amountRaw === '') continue;
    if (!isValidAccountName(account)) continue;
    if (!CATEGORY_NAMES.includes(category as CategoryName)) continue;
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount < 0) continue;
    out.push({
      financialYear: fy,
      account: account as AccountName,
      category: category as CategoryName,
      amount,
    });
  }
  return out;
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
    const ak = `${a.account}\t${a.financialYear}\t${a.category}`;
    const bk = `${b.account}\t${b.financialYear}\t${b.category}`;
    return ak.localeCompare(bk);
  });

  const lines = [HEADERS.join(',')];
  for (const r of sorted) {
    lines.push(
      [
        escapeCsvField(r.financialYear),
        escapeCsvField(r.account),
        escapeCsvField(r.category),
        String(Math.round(r.amount * 100) / 100),
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
