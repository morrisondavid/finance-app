import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  readObligationStateFromFile,
  writeObligationStateToFile,
  type ObligationStateRow,
} from './obligation-state.js';

describe('obligation-state paidFromTxHash', () => {
  it('round-trips paid_from_tx_hash through the CSV', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obl-state-'));
    const csvPath = path.join(dir, 'obligation-state.csv');
    const row: ObligationStateRow = {
      id: 'manual-1',
      status: 'paid',
      paidAmount: 2123.24,
      paidDate: '2026-05-14',
      paidFromAccount: 'barclaycard',
      paidFromTxHash: 'abc123hash',
      source: 'user',
    };
    writeObligationStateToFile(csvPath, [row]);
    const loaded = readObligationStateFromFile(csvPath);
    expect(loaded.get('manual-1')).toEqual(row);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loads legacy rows without paid_from_tx_hash as null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obl-state-legacy-'));
    const csvPath = path.join(dir, 'obligation-state.csv');
    fs.writeFileSync(
      csvPath,
      'id,status,paid_amount,paid_date,paid_from_account,source\n' +
      'manual-legacy,paid,100,2026-01-01,natwest,user\n',
      'utf8',
    );
    const loaded = readObligationStateFromFile(csvPath);
    expect(loaded.get('manual-legacy')?.paidFromTxHash).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
