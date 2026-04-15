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

  it('round-trips rows with account,category,amount header', () => {
    const rows: BudgetCsvRow[] = [
      {
        account: 'natwest',
        category: 'Groceries',
        amount: 12.5,
      },
      {
        account: 'barclays-current',
        category: 'Other',
        amount: 100,
      },
    ];
    writeBudgetsToCsvFile(csvPath, rows);
    const text = fs.readFileSync(csvPath, 'utf8');
    expect(text.startsWith('account,category,amount\n')).toBe(true);
    const parsed = readBudgetsFromCsvFile(csvPath);
    expect(parsed).toHaveLength(2);
    expect(parsed.find(r => r.account === 'barclays-current')?.amount).toBe(100);
    expect(parsed.find(r => r.account === 'natwest')?.amount).toBe(12.5);
  });

  it('returns [] when the CSV file does not exist', () => {
    expect(readBudgetsFromCsvFile(path.join(tmpDir, 'missing.csv'))).toEqual([]);
  });

  it('legacy financial_year column is ignored; last row wins per account+category', () => {
    fs.writeFileSync(
      csvPath,
      'financial_year,account,category,amount\n2024/25,barclays-current,Groceries,50\n2025/26,barclays-current,Groceries,75\n',
      'utf8',
    );
    const parsed = readBudgetsFromCsvFile(csvPath);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].amount).toBe(75);
    expect(parsed[0].category).toBe('Groceries');
  });
});
