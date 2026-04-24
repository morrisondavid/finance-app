/**
 * `collectPaymentOutsideContractWindow` coverage.
 *
 * Uses the real contracts / clients registries (seed data) plus an
 * account → entity mapping to exercise every branch:
 *   - in-window deposits emit nothing.
 *   - outside-window deposits emit exactly one warning each.
 *   - unknown payers emit nothing.
 *   - duplicate deposits dedupe by (client, date, account, amount).
 */

import { describe, it, expect } from 'vitest';
import type {
  EntityId,
  Transaction,
} from '../../../shared/api-contracts.js';
import { collectPaymentOutsideContractWindow } from './payment-outside-contract-window.js';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    date: '2026-05-12',
    description: 'BACS CREDIT LA FOSSE ASSOCIATES',
    amount: 8910,
    account: 'wise-fzco',
    type: 'income',
    ...overrides,
  };
}

// Real seed data: `lf-2026-apr` is la-fosse on autonize-it-fzco, ending
// 2026-04-30; `dc-sow-2026` is delta-capita on autonize-it-ltd, starting
// 2026-03-02 ending 2027-03-01.
const WISE_FZCO = 'wise-fzco';
const BARCLAYS = 'barclays-current';

function entityIdFor(account: string): EntityId | null {
  if (account === WISE_FZCO) return 'autonize-it-fzco';
  if (account === BARCLAYS) return 'autonize-it-ltd';
  return null;
}

describe('collectPaymentOutsideContractWindow', () => {
  it('emits a warning for a known payer depositing after the contract ended', () => {
    const warnings = collectPaymentOutsideContractWindow({
      transactions: [
        tx({ date: '2026-05-12', description: 'LA FOSSE WIRE' }),
      ],
      accountEntityId: entityIdFor,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('payment-outside-contract-window');
    expect(warnings[0].detail).toContain('La Fosse');
    expect(warnings[0].detail).toContain('lf-2026-apr');
  });

  it('emits nothing for an in-window deposit', () => {
    const warnings = collectPaymentOutsideContractWindow({
      transactions: [
        tx({
          date: '2026-04-15',
          description: 'DELTA CAPITA BACS',
          account: BARCLAYS,
          amount: 13200,
        }),
      ],
      accountEntityId: entityIdFor,
    });
    expect(warnings).toHaveLength(0);
  });

  it('emits nothing for an unknown payer', () => {
    const warnings = collectPaymentOutsideContractWindow({
      transactions: [tx({ description: 'ACME CORP PAYMENT' })],
      accountEntityId: entityIdFor,
    });
    expect(warnings).toHaveLength(0);
  });

  it('emits nothing for expense transactions', () => {
    const warnings = collectPaymentOutsideContractWindow({
      transactions: [
        tx({ type: 'expense', amount: -100, description: 'LA FOSSE REFUND' }),
      ],
      accountEntityId: entityIdFor,
    });
    expect(warnings).toHaveLength(0);
  });

  it('dedupes identical outside-window deposits', () => {
    const row = tx({ date: '2026-05-12', description: 'LA FOSSE WIRE' });
    const warnings = collectPaymentOutsideContractWindow({
      transactions: [row, row, row],
      accountEntityId: entityIdFor,
    });
    expect(warnings).toHaveLength(1);
  });

  it('skips transactions on accounts with no mapped entity', () => {
    const warnings = collectPaymentOutsideContractWindow({
      transactions: [
        tx({ account: 'natwest', description: 'LA FOSSE PERSONAL TRANSFER' }),
      ],
      accountEntityId: entityIdFor,
    });
    expect(warnings).toHaveLength(0);
  });
});
