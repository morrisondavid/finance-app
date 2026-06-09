import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildObligationRegistry } from './registry.js';
import { parseObligationRow } from './csv-io.js';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'obligations-'));
}

function writeCsv(dir: string, filename: string, rows: string[]): void {
  const header = [
    'id', 'category', 'frequency', 'merchant', 'display_name', 'account', 'amount',
    'currency', 'notes', 'ownership_david', 'ownership_heena', 'person_id',
    'amount_tolerance', 'due_date', 'tax_type', 'property_id', 'active', 'ended_at',
  ].join(',');
  fs.writeFileSync(path.join(dir, filename), [header, ...rows].join('\n'));
}

describe('parseObligationRow', () => {
  it('parses a fixed-bill row with GBP default', () => {
    const result = parseObligationRow({
      id: 'seed-ee', category: 'fixed-bill', frequency: 'monthly',
      merchant: 'EE', display_name: '', account: 'barclays-current',
      amount: '180', currency: '', notes: '',
      ownership_david: '', ownership_heena: '', person_id: '',
      amount_tolerance: '', due_date: '',
    });
    expect(result.category).toBe('fixed-bill');
    expect(result.amount).toBe(180);
    expect(result.currency).toBe('GBP');
  });

  it('parses a fixed-bill row with explicit AED currency', () => {
    const result = parseObligationRow({
      id: 'seed-mce', category: 'fixed-bill', frequency: 'monthly',
      merchant: 'MCE Advisory', display_name: '', account: 'emirates-islamic',
      amount: '4200', currency: 'AED', notes: '',
      ownership_david: '', ownership_heena: '', person_id: '',
      amount_tolerance: '', due_date: '',
    });
    expect(result.currency).toBe('AED');
  });

  it('parses a rental-income row with ownership split', () => {
    const result = parseObligationRow({
      id: 'seed-rent', category: 'rental-income', frequency: 'monthly',
      merchant: 'Stoneshaw Estates', display_name: '78 Hunters Square',
      account: 'monzo-joint', amount: '1292.72', currency: '', notes: '',
      ownership_david: '0.5', ownership_heena: '0.5', person_id: '',
      amount_tolerance: '', due_date: '', tax_type: '', property_id: 'hunters-square-78',
      active: 'true', ended_at: '',
    });
    expect(result.category).toBe('rental-income');
    if (result.category === 'rental-income') {
      expect(result.ownership.david).toBe(0.5);
      expect(result.ownership.heena).toBe(0.5);
    }
    expect(result.displayName).toBe('78 Hunters Square');
  });

  it('parses active=false and ended_at on a rental-income row', () => {
    const result = parseObligationRow({
      id: 'seed-thorney-house-56', category: 'rental-income', frequency: 'monthly',
      merchant: 'Prospect Holdings', display_name: '56 Thorney House',
      account: 'monzo-joint', amount: '979.2', currency: 'GBP', notes: '',
      ownership_david: '0.5', ownership_heena: '0.5', person_id: '',
      amount_tolerance: '', due_date: '', tax_type: '', property_id: 'thorney-house-56',
      active: 'false', ended_at: '2026-06-01',
    });
    expect(result.active).toBe(false);
    expect(result.endedAt).toBe('2026-06-01');
  });

  it('parses a payroll row with personId + tolerance', () => {
    const result = parseObligationRow({
      id: 'seed-payroll-david', category: 'payroll', frequency: 'monthly',
      merchant: 'David Morrison', display_name: 'Director salary — David',
      account: 'barclays-current', amount: '758', currency: '', notes: '',
      ownership_david: '', ownership_heena: '', person_id: 'david',
      amount_tolerance: '10', due_date: '',
    });
    expect(result.category).toBe('payroll');
    if (result.category === 'payroll') {
      expect(result.personId).toBe('david');
      expect(result.amountTolerance).toBe(10);
    }
  });

  it('parses an insurance row with due date', () => {
    const result = parseObligationRow({
      id: 'u-orient', category: 'insurance', frequency: 'annual',
      merchant: 'Orient Insurance PJSC', display_name: 'Professional Indemnity',
      account: 'emirates-islamic', amount: '25200', currency: 'AED',
      notes: '', ownership_david: '', ownership_heena: '', person_id: '',
      amount_tolerance: '', due_date: '2027-03-27',
    });
    expect(result.category).toBe('insurance');
    if (result.category === 'insurance') {
      expect(result.dueDate).toBe('2027-03-27');
    }
    expect(result.frequency).toBe('annual');
  });

  it('parses a tax-manual row and preserves the taxType subtype', () => {
    const result = parseObligationRow({
      id: 'u-vat-2026q1', category: 'tax-manual', frequency: 'quarterly',
      merchant: 'HMRC', display_name: 'VAT Q1 2026',
      account: '', amount: '1500', currency: 'GBP',
      notes: '', ownership_david: '', ownership_heena: '',
      person_id: '', amount_tolerance: '', due_date: '2026-05-07',
      tax_type: 'vat',
    });
    expect(result.category).toBe('tax-manual');
    if (result.category === 'tax-manual') {
      expect(result.taxType).toBe('vat');
    }
  });

  it('parses a tax-manual row without taxType (backwards compatibility)', () => {
    const result = parseObligationRow({
      id: 'u-legacy-sa', category: 'tax-manual', frequency: 'annual',
      merchant: 'HMRC', display_name: 'Self Assessment',
      account: '', amount: '2083.54', currency: 'GBP',
      notes: '', ownership_david: '', ownership_heena: '',
      person_id: '', amount_tolerance: '', due_date: '2026-01-31',
      tax_type: '',
    });
    expect(result.category).toBe('tax-manual');
    if (result.category === 'tax-manual') {
      expect(result.taxType).toBeUndefined();
    }
  });

  it('rejects an unknown category', () => {
    expect(() =>
      parseObligationRow({
        id: 'bad', category: 'loan-repayment', frequency: 'monthly',
        merchant: 'X', display_name: '', account: 'barclays-current',
        amount: '100', currency: '', notes: '',
        ownership_david: '', ownership_heena: '', person_id: '',
        amount_tolerance: '', due_date: '',
      }),
    ).toThrow(/unknown category/);
  });

  it('rejects a missing amount', () => {
    expect(() =>
      parseObligationRow({
        id: 'bad', category: 'fixed-bill', frequency: 'monthly',
        merchant: 'X', display_name: '', account: 'barclays-current',
        amount: '', currency: '', notes: '',
        ownership_david: '', ownership_heena: '', person_id: '',
        amount_tolerance: '', due_date: '',
      }),
    ).toThrow(/amount is required/);
  });

  it('rejects non-numeric amount', () => {
    expect(() =>
      parseObligationRow({
        id: 'bad', category: 'fixed-bill', frequency: 'monthly',
        merchant: 'X', display_name: '', account: 'barclays-current',
        amount: 'not-a-number', currency: '', notes: '',
        ownership_david: '', ownership_heena: '', person_id: '',
        amount_tolerance: '', due_date: '',
      }),
    ).toThrow(/must be numeric/);
  });
});

describe('buildObligationRegistry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty registry when neither CSV exists', () => {
    const reg = buildObligationRegistry(tmpDir);
    expect(reg.all).toHaveLength(0);
    expect(reg.incoming).toHaveLength(0);
    expect(reg.outgoing).toHaveLength(0);
  });

  it('loads seed rows and categorises incoming vs outgoing', () => {
    writeCsv(tmpDir, 'obligations-seed.csv', [
      'seed-ee,fixed-bill,monthly,EE,,barclays-current,180,GBP,,,,,,,,',
      'seed-rent,rental-income,monthly,Stoneshaw,78 HS,monzo-joint,1292.72,GBP,,0.5,0.5,,,,,p-test',
    ]);
    const reg = buildObligationRegistry(tmpDir);
    expect(reg.all).toHaveLength(2);
    expect(reg.outgoing).toHaveLength(1);
    expect(reg.incoming).toHaveLength(1);
  });

  it('user rows override seed rows with the same id', () => {
    writeCsv(tmpDir, 'obligations-seed.csv', [
      'seed-ee,fixed-bill,monthly,EE,,barclays-current,180,GBP,,,,,,',
    ]);
    writeCsv(tmpDir, 'obligations.csv', [
      'seed-ee,fixed-bill,monthly,EE,,barclays-current,195,GBP,bumped,,,,,',
    ]);
    const reg = buildObligationRegistry(tmpDir);
    expect(reg.all).toHaveLength(1);
    expect(reg.all[0]?.amount).toBe(195);
    expect(reg.all[0]?.notes).toBe('bumped');
  });

  it('listByCategory narrows the return type', () => {
    writeCsv(tmpDir, 'obligations-seed.csv', [
      'seed-ee,fixed-bill,monthly,EE,,barclays-current,180,GBP,,,,,,,,',
      'seed-rent,rental-income,monthly,Stoneshaw,78 HS,monzo-joint,1292.72,GBP,,0.5,0.5,,,,,p-test',
    ]);
    const reg = buildObligationRegistry(tmpDir);
    const rentals = reg.listByCategory('rental-income');
    expect(rentals).toHaveLength(1);
    expect(rentals[0]?.ownership).toEqual({ david: 0.5, heena: 0.5 });
  });

  it('matchByMerchantAccount returns the matching row or null', () => {
    writeCsv(tmpDir, 'obligations-seed.csv', [
      'seed-ee,fixed-bill,monthly,EE,,barclays-current,180,GBP,,,,,,',
    ]);
    const reg = buildObligationRegistry(tmpDir);
    expect(reg.matchByMerchantAccount('EE', 'barclays-current')?.id).toBe('seed-ee');
    expect(reg.matchByMerchantAccount('EE', 'natwest')).toBeNull();
    expect(reg.matchByMerchantAccount('Unknown', 'barclays-current')).toBeNull();
  });

  it('listByCadence groups by frequency', () => {
    writeCsv(tmpDir, 'obligations-seed.csv', [
      'seed-ee,fixed-bill,monthly,EE,,barclays-current,180,GBP,,,,,,',
      'seed-ins,insurance,annual,Orient,,emirates-islamic,5292,GBP,,,,,,2027-03-27',
    ]);
    const reg = buildObligationRegistry(tmpDir);
    expect(reg.listByCadence('monthly')).toHaveLength(1);
    expect(reg.listByCadence('annual')).toHaveLength(1);
    expect(reg.listByCadence('quarterly')).toHaveLength(0);
  });
});
