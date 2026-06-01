import { describe, expect, it } from 'vitest';
import {
  EMIRATES_ISLAMIC_ACCOUNT_NAMES,
  extractLaFosseSupplierRefs,
  laFosseDepositAccountNames,
  laFosseDepositAmountForMatch,
} from './la-fosse-reconcile-accounts.js';

describe('laFosseDepositAccountNames', () => {
  it('includes all Emirates Islamic pockets and UK Barclays for FZCO', () => {
    const names = laFosseDepositAccountNames('autonize-it-fzco');
    for (const pocket of EMIRATES_ISLAMIC_ACCOUNT_NAMES) {
      expect(names).toContain(pocket);
    }
    expect(names).toContain('barclays-current');
  });

  it('includes Emirates pockets for UK Ltd La Fosse transition deposits', () => {
    const names = laFosseDepositAccountNames('autonize-it-ltd');
    expect(names).toContain('barclays-current');
    for (const pocket of EMIRATES_ISLAMIC_ACCOUNT_NAMES) {
      expect(names).toContain(pocket);
    }
  });
});

describe('extractLaFosseSupplierRefs', () => {
  it('parses spaced INV paths from Emirates narratives', () => {
    const desc =
      '/INV/SB-293519/INV/SB-293520/ INV/SB -293521/INV/SB-293522';
    expect(extractLaFosseSupplierRefs(desc)).toEqual([
      'SB-293519',
      'SB-293520',
      'SB-293521',
      'SB-293522',
    ]);
  });
});

describe('laFosseDepositAmountForMatch', () => {
  it('uses the GBP leg quoted on an AED ledger row', () => {
    expect(
      laFosseDepositAmountForMatch({
        amount: 45760.65,
        currency: 'AED',
        description: 'GBP 9500@4.81691 LA FOSSE',
      }),
    ).toBe(9500);
  });
});
