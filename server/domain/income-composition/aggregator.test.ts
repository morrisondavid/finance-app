import { describe, it, expect } from 'vitest';
import { listAllIncomeSources } from './aggregator.js';
import type { Contract, Obligation, RecurringExpense } from '../../../shared/api-contracts.js';

function makeContract(over: Partial<Contract> = {}): Contract {
  const base: Contract = {
    id: 'c1',
    client_id: 'delta-capita',
    issuing_entity_id: 'autonize-it-ltd',
    master_id: null,
    reference: 'REF',
    start_date: '2026-01-01',
    end_date: null,
    works_monday: true,
    works_tuesday: true,
    works_wednesday: true,
    works_thursday: true,
    works_friday: true,
    works_saturday: false,
    works_sunday: false,
    day_rate: 600,
    day_rate_currency: 'GBP',
    invoice_currency: 'GBP',
    invoice_cadence: 'monthly',
    invoice_mechanism: 'self-bill',
    payment_terms_days: 30,
    company_notice_weeks: 4,
    supplier_notice_weeks: 4,
    renewal_warning_days: 60,
    job_title: 'Engineer',
    job_description: null,
    work_location: 'London',
    conduct_regs: 'opted-out',
    engagement_tax_status: 'outside-ir35',
    jurisdiction: 'England',
    signed_at: '2026-01-01',
    docusign_envelope: null,
    active: true,
    updated_at: '2026-01-01',
  };
  return { ...base, ...over };
}

function makeRentalObligation(over: Partial<Extract<Obligation, { category: 'rental-income' }>> = {}): Obligation {
  return {
    id: 'r1',
    category: 'rental-income',
    frequency: 'monthly',
    merchant: 'Stoneshaw Estates',
    displayName: '78 Hunters Square',
    account: 'monzo-joint',
    amount: 1292.72,
    currency: 'GBP',
    notes: undefined,
    propertyId: 'hunters-square-78',
    ownership: { david: 0.5, heena: 0.5 },
    ...over,
  } as Obligation;
}

function makeRecurringIncome(over: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    merchant: 'INTEREST CREDIT',
    category: 'Other',
    colour: '#000',
    amount: 12.34,
    frequency: 'monthly',
    monthsActive: 12,
    annualTotal: 148.08,
    logoUrl: null,
    sourceAccount: 'natwest-savings',
    billingDayOfMonth: null,
    billingMonth: null,
    ...over,
  };
}

const clientLabelById = new Map<string, string>([
  ['delta-capita', 'Delta Capita'],
]);

describe('listAllIncomeSources', () => {
  it('emits a contract source with day_rate × ~21.7 days/month for Mon-Fri', () => {
    const out = listAllIncomeSources({
      contracts: [makeContract({ day_rate: 600 })],
      obligations: [],
      monthlyIncomeRecurring: [],
      clientLabelById,
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('contract');
    expect(out[0].activityClass).toBe('active');
    expect(out[0].label).toBe('Delta Capita');
    // 600 * (5 weekdays * 52.143/12) ≈ 13035.75
    expect(out[0].monthlyAmount).toBeGreaterThan(13000);
    expect(out[0].monthlyAmount).toBeLessThan(13100);
  });

  it('skips inactive contracts', () => {
    const out = listAllIncomeSources({
      contracts: [makeContract({ active: false })],
      obligations: [],
      monthlyIncomeRecurring: [],
      clientLabelById,
    });
    expect(out).toHaveLength(0);
  });

  it('emits one source per rental-income obligation, gross at face value', () => {
    const out = listAllIncomeSources({
      contracts: [],
      obligations: [makeRentalObligation()],
      monthlyIncomeRecurring: [],
      clientLabelById,
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('rental-income');
    expect(out[0].monthlyAmount).toBe(1292.72);
    expect(out[0].propertyId).toBe('hunters-square-78');
    expect(out[0].activityClass).toBe('passive');
  });

  it('skips recurring income whose category is already represented (Property/Payroll/Transfers/Income/Dividends)', () => {
    const out = listAllIncomeSources({
      contracts: [],
      obligations: [],
      monthlyIncomeRecurring: [
        makeRecurringIncome({ category: 'Property', merchant: 'Stoneshaw' }),
        makeRecurringIncome({ category: 'Payroll', merchant: 'David Morrison Salary' }),
        makeRecurringIncome({ category: 'Transfers', merchant: 'Internal' }),
        makeRecurringIncome({ category: 'Income', merchant: 'Generic' }),
        makeRecurringIncome({ category: 'Dividends', merchant: 'UK Ltd Dividend' }),
      ],
      clientLabelById,
    });
    expect(out).toHaveLength(0);
  });

  it('includes recurring income whose category is NOT a known duplicate', () => {
    const out = listAllIncomeSources({
      contracts: [],
      obligations: [],
      monthlyIncomeRecurring: [
        makeRecurringIncome({ category: 'Other', merchant: 'INTEREST CREDIT' }),
      ],
      clientLabelById,
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('recurring-detected');
    expect(out[0].activityClass).toBe('passive');
  });
});
