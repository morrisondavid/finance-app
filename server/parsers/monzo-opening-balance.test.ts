/**
 * Monzo opening balance anchor from Balance column.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  deriveMonzoOpeningAnchorFromCsvContent,
  maybeApplyMonzoOpeningBalanceFromCsvFile,
} from './monzo-opening-balance.js';
import { readOpeningBalancesFromCsv } from '../db/opening-balances-csv.js';

const CSV_WITH_BALANCE =
  'Transaction ID,Date,Time,Type,Name,Amount,Balance\n' +
  'tx1,01/01/2026,,,Start,-100.00,900.00\n' +
  'tx2,02/01/2026,,,Credit,50.00,950.00\n';

describe('deriveMonzoOpeningAnchorFromCsvContent', () => {
  it('computes opening from first row balance minus amount', () => {
    const anchor = deriveMonzoOpeningAnchorFromCsvContent(CSV_WITH_BALANCE);
    expect(anchor).not.toBeNull();
    expect(anchor?.openingBalance).toBe(1000);
    expect(anchor?.openingBalanceDate).toBe('2026-01-01');
    expect(anchor?.lastBalance).toBe(950);
    expect(anchor?.lastBalanceDate).toBe('2026-01-02');
  });

  it('returns null when Balance column is absent', () => {
    const csv =
      'Transaction ID,Date,Name,Amount\n' +
      'tx1,01/01/2026,Shop,-3.50\n';
    expect(deriveMonzoOpeningAnchorFromCsvContent(csv)).toBeNull();
  });
});

describe('maybeApplyMonzoOpeningBalanceFromCsvFile', () => {
  let tmpDir: string;
  let csvPath: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monzo-opening-'));
    csvPath = path.join(tmpDir, 'export.csv');
    fs.writeFileSync(csvPath, CSV_WITH_BALANCE, 'utf-8');
    prevEnv = process.env.BANK_STATEMENTS_OPENING_BALANCES_CSV;
    process.env.BANK_STATEMENTS_OPENING_BALANCES_CSV = path.join(tmpDir, 'opening-balances.csv');
  });

  afterEach(() => {
    if (prevEnv === undefined) {
      delete process.env.BANK_STATEMENTS_OPENING_BALANCES_CSV;
    } else {
      process.env.BANK_STATEMENTS_OPENING_BALANCES_CSV = prevEnv;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes opening anchor for monzo-joint when unset', () => {
    const anchor = maybeApplyMonzoOpeningBalanceFromCsvFile('monzo-joint', csvPath);
    expect(anchor?.openingBalance).toBe(1000);
    const rows = readOpeningBalancesFromCsv();
    const row = rows.find(r => r.account === 'monzo-joint');
    expect(row?.openingBalance).toBe(1000);
    expect(row?.openingBalanceDate).toBe('2026-01-01');
  });

  it('does not overwrite manual opening balance', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'opening-balances.csv'),
      'account,opening_balance,opening_balance_date\nmonzo-joint,42.00,2025-01-01\n',
      'utf-8',
    );
    const anchor = maybeApplyMonzoOpeningBalanceFromCsvFile('monzo-joint', csvPath);
    expect(anchor).toBeNull();
    const row = readOpeningBalancesFromCsv().find(r => r.account === 'monzo-joint');
    expect(row?.openingBalance).toBe(42);
  });
});
