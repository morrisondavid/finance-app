import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readBudgetsFromCsvFile,
  writeBudgetsToCsvFile,
  getBudgetCsvPath,
} from './budgets-csv.js';
import type { BudgetCsvRow } from './budgets-csv.js';

describe('budgets CSV', () => {
  let tmpDir: string;
  let csvPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budgets-csv-test-'));
    csvPath = getBudgetCsvPath(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips rows with stable sorted column order', () => {
    const rows: BudgetCsvRow[] = [
      {
        financialYear: '2025/26',
        account: 'natwest',
        category: 'Groceries',
        amount: 12.5,
      },
      {
        financialYear: '2025/26',
        account: 'barclays-current',
        category: 'Other',
        amount: 100,
      },
    ];
    writeBudgetsToCsvFile(csvPath, rows);
    const text = fs.readFileSync(csvPath, 'utf8');
    expect(text.startsWith('financial_year,account,category,amount\n')).toBe(true);
    const parsed = readBudgetsFromCsvFile(csvPath);
    expect(parsed).toHaveLength(2);
    expect(parsed.find(r => r.account === 'barclays-current')?.amount).toBe(100);
    expect(parsed.find(r => r.account === 'natwest')?.amount).toBe(12.5);
  });

  it('returns [] when the CSV file does not exist', () => {
    expect(readBudgetsFromCsvFile(path.join(tmpDir, 'missing.csv'))).toEqual([]);
  });
});
