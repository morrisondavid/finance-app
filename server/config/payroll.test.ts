import { describe, it, expect } from 'vitest';
import { matchPayrollEntry, transactionCategoryWithPayroll } from './payroll.js';

describe('matchPayrollEntry', () => {
  it('matches David on barclays-current near expected amount', () => {
    const hit = matchPayrollEntry('barclays-current', 758, 'STO SALARY DAVID MORRISON');
    expect(hit?.personId).toBe('david');
    expect(hit?.displayName).toBe('Director salary — David');
  });

  it('matches via short-form alias (D MORRISON)', () => {
    const hit = matchPayrollEntry('barclays-current', 758, 'STO SALARY D MORRISON');
    expect(hit?.personId).toBe('david');
  });

  it('matches Heena by her married-name alias (HEENA MORRISON)', () => {
    const hit = matchPayrollEntry('barclays-current', 758, 'STO PAYROLL HEENA MORRISON');
    expect(hit?.personId).toBe('heena');
  });

  it('returns null for dividend lines', () => {
    const hit = matchPayrollEntry('barclays-current', 758, 'STO DIVIDEND DAVID MORRISON');
    expect(hit).toBeNull();
  });

  it('returns null when amount is far from expected', () => {
    const hit = matchPayrollEntry('barclays-current', 9999, 'STO SALARY DAVID MORRISON');
    expect(hit).toBeNull();
  });

  it('returns null when description does not match any person alias', () => {
    const hit = matchPayrollEntry('barclays-current', 758, 'STO SALARY SOMEONE ELSE');
    expect(hit).toBeNull();
  });

  it('returns null when no payroll obligation exists for that account', () => {
    const hit = matchPayrollEntry('emirates-islamic', 758, 'STO SALARY DAVID MORRISON');
    expect(hit).toBeNull();
  });
});

describe('resolveExpenseCategoryWithPayroll (via transactionCategoryWithPayroll)', () => {
  it('maps registry Payroll without obligation amount match to Transfers (drops from Fixed Expenses)', () => {
    expect(
      transactionCategoryWithPayroll('STO SALARY DAVID MORRISON', -9999, 'barclays-current', 'transfer'),
    ).toBe('Transfers');
  });

  it('still maps configured salary amount to Payroll', () => {
    expect(
      transactionCategoryWithPayroll('STO SALARY DAVID MORRISON', -758, 'barclays-current', 'transfer'),
    ).toBe('Payroll');
  });
});

describe('transactionCategoryWithPayroll', () => {
  it('returns Payroll for configured outgoing transfer', () => {
    const cat = transactionCategoryWithPayroll(
      'STO SALARY DAVID MORRISON',
      -758,
      'barclays-current',
      'transfer',
    );
    expect(cat).toBe('Payroll');
  });

  it('returns Transfers when registry says salary but amount does not match payroll config', () => {
    // Undeclared payroll accounts / amount mismatches are silently
    // dropped from Fixed Expenses rather than being mis-labelled Business.
    expect(
      transactionCategoryWithPayroll('STO SALARY DAVID MORRISON', -9999, 'barclays-current', 'transfer'),
    ).toBe('Transfers');
  });

  it('returns Transfers for salary-worded txn on account without a payroll obligation', () => {
    // David's salary obligation is on barclays-current only; an emirates-
    // islamic salary-worded debit has no matching obligation → Transfers.
    expect(
      transactionCategoryWithPayroll('STO SALARY DAVID MORRISON', -758, 'emirates-islamic', 'transfer'),
    ).toBe('Transfers');
  });

  it('leaves generic David transfer as Transfers', () => {
    expect(
      transactionCategoryWithPayroll('DAVID MORRISON', -500, 'barclays-current', 'transfer'),
    ).toBe('Transfers');
  });
});
