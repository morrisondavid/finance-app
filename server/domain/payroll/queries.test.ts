import { describe, it, expect } from 'vitest';
import {
  allPayrollEntries,
  getDirectorPayroll,
  matchPayrollEntry,
  resolveExpenseCategoryWithPayroll,
  transactionCategoryWithPayroll,
} from './queries.js';
import { makeTestPayrollRegistry } from './fixtures.js';
import type { PayrollEntry, PayrollRegistry } from './registry.js';
import type { DirectorPayroll } from './schema.js';
import type { PersonId } from '../people/index.js';

const reg = makeTestPayrollRegistry();

describe('allPayrollEntries', () => {
  it('returns the same ordered list as indexes.entries', () => {
    expect(allPayrollEntries(reg)).toBe(reg.indexes.entries);
  });
});

describe('getDirectorPayroll', () => {
  it('returns a hydrated record for David', () => {
    const d = getDirectorPayroll('david', reg);
    expect(d).toBeDefined();
    expect(d!.monthlySalary).toBeGreaterThan(0);
    expect(d!.code).toBe('DA');
    expect(d!.label).toBe("David's Tax");
    expect(d!.namePattern).toBe('%DAVID MORRISON%');
  });

  it('returns undefined for a director without a payroll obligation', () => {
    const emptyReg: PayrollRegistry = {
      indexes: {
        entries: [],
        byAccount: new Map<string, readonly PayrollEntry[]>(),
        byPersonAccount: new Map<string, readonly PayrollEntry[]>(),
        directorsById: new Map<PersonId, DirectorPayroll>(),
      },
    };
    expect(getDirectorPayroll('david', emptyReg)).toBeUndefined();
  });
});

describe('matchPayrollEntry', () => {
  it('matches David on barclays-current near expected amount', () => {
    const hit = matchPayrollEntry(
      'barclays-current',
      758,
      'STO SALARY DAVID MORRISON',
      reg,
    );
    expect(hit?.personId).toBe('david');
    expect(hit?.displayName).toBe('Director salary — David');
  });

  it('matches via short-form alias (D MORRISON)', () => {
    const hit = matchPayrollEntry(
      'barclays-current',
      758,
      'STO SALARY D MORRISON',
      reg,
    );
    expect(hit?.personId).toBe('david');
  });

  it('matches Heena by her married-name alias (HEENA MORRISON)', () => {
    const hit = matchPayrollEntry(
      'barclays-current',
      758,
      'STO PAYROLL HEENA MORRISON',
      reg,
    );
    expect(hit?.personId).toBe('heena');
  });

  it('returns null for dividend lines', () => {
    const hit = matchPayrollEntry(
      'barclays-current',
      758,
      'STO DIVIDEND DAVID MORRISON',
      reg,
    );
    expect(hit).toBeNull();
  });

  it('returns null when amount is far from expected', () => {
    const hit = matchPayrollEntry(
      'barclays-current',
      9999,
      'STO SALARY DAVID MORRISON',
      reg,
    );
    expect(hit).toBeNull();
  });

  it('returns null when description does not match any person alias', () => {
    const hit = matchPayrollEntry(
      'barclays-current',
      758,
      'STO SALARY SOMEONE ELSE',
      reg,
    );
    expect(hit).toBeNull();
  });

  it('returns null when no payroll obligation exists for that account', () => {
    const hit = matchPayrollEntry(
      'emirates-islamic',
      758,
      'STO SALARY DAVID MORRISON',
      reg,
    );
    expect(hit).toBeNull();
  });
});

describe('resolveExpenseCategoryWithPayroll', () => {
  it('returns Payroll when an obligation matches', () => {
    const r = resolveExpenseCategoryWithPayroll(
      'STO SALARY DAVID MORRISON',
      'barclays-current',
      758,
      'Payroll',
      reg,
    );
    expect(r.category).toBe('Payroll');
    expect(r.payrollHit).not.toBeNull();
  });

  it('maps registry Payroll without obligation amount match to Transfers', () => {
    const r = resolveExpenseCategoryWithPayroll(
      'STO SALARY DAVID MORRISON',
      'barclays-current',
      9999,
      'Payroll',
      reg,
    );
    expect(r.category).toBe('Transfers');
    expect(r.payrollHit).toBeNull();
  });

  it('maps registry Payroll with DIVIDEND in description to Dividends', () => {
    const r = resolveExpenseCategoryWithPayroll(
      'STO DIVIDEND DAVID MORRISON',
      'barclays-current',
      9999,
      'Payroll',
      reg,
    );
    expect(r.category).toBe('Dividends');
  });

  it('leaves non-payroll categories unchanged', () => {
    const r = resolveExpenseCategoryWithPayroll(
      'TESCO STORES',
      'barclays-current',
      25,
      'Groceries',
      reg,
    );
    expect(r.category).toBe('Groceries');
  });
});

describe('transactionCategoryWithPayroll', () => {
  it('returns Payroll for configured outgoing transfer', () => {
    const cat = transactionCategoryWithPayroll(
      'STO SALARY DAVID MORRISON',
      -758,
      'barclays-current',
      'transfer',
      undefined,
      reg,
    );
    expect(cat).toBe('Payroll');
  });

  it('returns Transfers when registry says salary but amount does not match payroll config', () => {
    expect(
      transactionCategoryWithPayroll(
        'STO SALARY DAVID MORRISON',
        -9999,
        'barclays-current',
        'transfer',
        undefined,
        reg,
      ),
    ).toBe('Transfers');
  });

  it('returns Transfers for salary-worded txn on account without a payroll obligation', () => {
    expect(
      transactionCategoryWithPayroll(
        'STO SALARY DAVID MORRISON',
        -758,
        'emirates-islamic',
        'transfer',
        undefined,
        reg,
      ),
    ).toBe('Transfers');
  });

  it('leaves generic David transfer as Transfers', () => {
    expect(
      transactionCategoryWithPayroll(
        'DAVID MORRISON',
        -500,
        'barclays-current',
        'transfer',
        undefined,
        reg,
      ),
    ).toBe('Transfers');
  });
});
