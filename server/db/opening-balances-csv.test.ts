/**
 * Opening balance CSV bootstrap and backfill for newly added accounts.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureOpeningBalancesCsvExists,
  readOpeningBalancesFromCsv,
} from './opening-balances-csv.js';

const tmpDir = path.join(os.tmpdir(), `opening-balances-csv-test-${process.pid}`);
const csvPath = path.join(tmpDir, 'opening-balances.csv');

afterEach(() => {
  delete process.env.BANK_STATEMENTS_OPENING_BALANCES_CSV;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ensureOpeningBalancesCsvExists', () => {
  it('backfills barclays-savings when an older CSV omits it', () => {
    process.env.BANK_STATEMENTS_OPENING_BALANCES_CSV = csvPath;
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      csvPath,
      [
        'account,opening_balance,opening_balance_date',
        'barclays-current,63035.54,2022-04-19',
      ].join('\n') + '\n',
    );

    const rows = ensureOpeningBalancesCsvExists();
    const savings = rows.find(r => r.account === 'barclays-savings');
    expect(savings).toEqual({
      account: 'barclays-savings',
      openingBalance: 0,
      openingBalanceDate: '2024-01-01',
    });

    const fromDisk = readOpeningBalancesFromCsv(csvPath);
    expect(fromDisk.some(r => r.account === 'barclays-savings')).toBe(true);
    expect(fromDisk.find(r => r.account === 'barclays-current')?.openingBalance).toBe(63035.54);
  });
});
