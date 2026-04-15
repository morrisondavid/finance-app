import { describe, it, expect } from 'vitest';
import { matchPayrollEntry, transactionCategoryWithPayroll } from './payroll.js';
import { normalizeMerchant } from '../utils/merchant-normalizer.js';

describe('matchPayrollEntry', () => {
  it('matches David on barclays-current near expected amount', () => {
    const m = normalizeMerchant('STO SALARY DAVID MORRISON');
    const hit = matchPayrollEntry(m, 'barclays-current', 765, 'STO SALARY DAVID MORRISON');
    expect(hit?.displayName).toBe('Director salary — David');
  });

  it('returns null for dividend lines', () => {
    const m = normalizeMerchant('STO DIVIDEND DAVID MORRISON');
    const hit = matchPayrollEntry(m, 'barclays-current', 765, 'STO DIVIDEND DAVID MORRISON');
    expect(hit).toBeNull();
  });

  it('returns null when amount is far from expected', () => {
    const m = normalizeMerchant('STO SALARY DAVID MORRISON');
    const hit = matchPayrollEntry(m, 'barclays-current', 9999, 'STO SALARY DAVID MORRISON');
    expect(hit).toBeNull();
  });
});

describe('transactionCategoryWithPayroll', () => {
  it('returns Payroll for configured outgoing transfer', () => {
    const cat = transactionCategoryWithPayroll(
      'STO SALARY DAVID MORRISON',
      -765,
      'barclays-current',
      'transfer',
    );
    expect(cat).toBe('Payroll');
  });

  it('leaves generic David transfer as Transfers', () => {
    expect(
      transactionCategoryWithPayroll('DAVID MORRISON', -500, 'barclays-current', 'transfer'),
    ).toBe('Transfers');
  });
});
