import { describe, it, expect } from 'vitest';
import {
  deriveTaxReserveWarnings,
  maxReserveLookaheadDays,
  RESERVE_LOOKAHEAD_DAYS,
} from './tax-reserve.js';
import type {
  AccountName,
  ObligationRow,
} from '../../../shared/api-contracts.js';
import type { Reserve } from '../reserves/schema.js';

const today = '2026-01-15';

function makeReserve(over: Partial<Reserve> = {}): Reserve {
  return {
    obligation_type: 'vat',
    entity_id: 'autonize-it-ltd',
    reserve_account: 'barclays-savings',
    notes: null,
    updated_at: '2026-01-01',
    lookahead_days: 90,
    ...over,
  };
}

function makeObligation(over: Partial<ObligationRow> = {}): ObligationRow {
  return {
    id: 'o1',
    source: 'auto',
    type: 'vat',
    name: 'UK VAT Q1',
    entity: 'autonize-it-ltd',
    frequency: 'one-off',
    expectedAmount: 5000,
    dueDate: '2026-03-01',
    status: 'pending',
    paidAmount: null,
    paidDate: null,
    paidFromAccount: null,
    notes: null,
    personId: null,
    createdAt: null,
    updatedAt: null,
    ...over,
  };
}

function balances(map: Record<string, number>): ReadonlyMap<AccountName, number> {
  return new Map(Object.entries(map) as Array<[AccountName, number]>);
}

function contributions(map: Record<string, number>): ReadonlyMap<AccountName, number> {
  return new Map(Object.entries(map) as Array<[AccountName, number]>);
}

describe('tax-reserve-underfunded', () => {
  it('emits when balance < liability and gap > 50% of liability → critical', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [makeObligation({ expectedAmount: 10000 })],
      balanceByAccount: balances({ 'barclays-savings': 1000 }),
      monthlyContributionByAccount: contributions({}),
    });
    const w = out.find(o => o.code === 'tax-reserve-underfunded');
    expect(w).toBeDefined();
    expect(w?.severity).toBe('critical');
    expect(w?.context?.shortfall).toBe(9000);
    expect(w?.context?.currentBalance).toBe(1000);
    expect(w?.context?.liability).toBe(10000);
    expect(w?.entityId).toBe('autonize-it-ltd');
  });

  it('emits warn when balance < liability but gap < 50%', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [makeObligation({ expectedAmount: 10000 })],
      balanceByAccount: balances({ 'barclays-savings': 7000 }),
      monthlyContributionByAccount: contributions({}),
    });
    const w = out.find(o => o.code === 'tax-reserve-underfunded');
    expect(w?.severity).toBe('warn');
  });

  it('does not emit when balance >= liability', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [makeObligation({ expectedAmount: 10000 })],
      balanceByAccount: balances({ 'barclays-savings': 10000 }),
      monthlyContributionByAccount: contributions({}),
    });
    expect(out.find(o => o.code === 'tax-reserve-underfunded')).toBeUndefined();
  });
});

describe('tax-reserve-trajectory-missing', () => {
  it('fires when projected balance at due date < liability', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [makeObligation({ expectedAmount: 10000, dueDate: '2026-04-15' })],
      balanceByAccount: balances({ 'barclays-savings': 4000 }),
      monthlyContributionByAccount: contributions({ 'barclays-savings': 1000 }),
    });
    const w = out.find(o => o.code === 'tax-reserve-trajectory-missing');
    expect(w).toBeDefined();
    expect(w?.context?.monthlyContribution).toBe(1000);
    expect(w?.context?.gap).toBeGreaterThan(0);
    expect(w?.context?.monthlyTopUpNeeded).toBeGreaterThan(0);
  });

  it('does NOT fire when balance is already over liability', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [makeObligation({ expectedAmount: 5000, dueDate: '2026-04-15' })],
      balanceByAccount: balances({ 'barclays-savings': 6000 }),
      monthlyContributionByAccount: contributions({ 'barclays-savings': 1000 }),
    });
    expect(out.find(o => o.code === 'tax-reserve-trajectory-missing')).toBeUndefined();
  });

  it('can fire alongside underfunded when due date is far enough out', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [makeObligation({ expectedAmount: 10000, dueDate: '2026-04-15' })],
      balanceByAccount: balances({ 'barclays-savings': 1000 }),
      monthlyContributionByAccount: contributions({ 'barclays-savings': 100 }),
    });
    expect(out.filter(o => o.code === 'tax-reserve-underfunded')).toHaveLength(1);
    expect(out.filter(o => o.code === 'tax-reserve-trajectory-missing')).toHaveLength(1);
  });

  it('uses lump-sum action text when due within one month', () => {
    const out = deriveTaxReserveWarnings({
      today: '2026-06-05',
      reserves: [makeReserve()],
      obligations: [makeObligation({ expectedAmount: 9270, dueDate: '2026-06-07' })],
      balanceByAccount: balances({ 'barclays-savings': 5025 }),
      monthlyContributionByAccount: contributions({}),
    });
    const w = out.find(o => o.code === 'tax-reserve-trajectory-missing');
    expect(w).toBeUndefined();
    const under = out.find(o => o.code === 'tax-reserve-underfunded');
    expect(under).toBeDefined();
  });
});

describe('missing reserve → no warning (config gap, not violation)', () => {
  it('skips legacy auto-seeded rows with entity HMRC (not an EntityId)', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [makeObligation({ entity: 'HMRC', expectedAmount: 10000 })],
      balanceByAccount: balances({ 'barclays-savings': 0 }),
      monthlyContributionByAccount: contributions({}),
    });
    expect(out).toHaveLength(0);
  });

  it('emits nothing when no reserve is configured for the obligation type/entity', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [],
      obligations: [makeObligation({ expectedAmount: 10000 })],
      balanceByAccount: balances({ 'barclays-savings': 0 }),
      monthlyContributionByAccount: contributions({}),
    });
    expect(out).toHaveLength(0);
  });
});

describe('window filtering', () => {
  it('ignores obligations due past the reserve lookahead window', () => {
    const farFuture = '2027-12-31';
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve({ lookahead_days: 90 })],
      obligations: [makeObligation({ expectedAmount: 10000, dueDate: farFuture })],
      balanceByAccount: balances({ 'barclays-savings': 0 }),
      monthlyContributionByAccount: contributions({}),
    });
    expect(out).toHaveLength(0);
  });

  it('includes CT due within 365-day lookahead', () => {
    const out = deriveTaxReserveWarnings({
      today: '2026-06-05',
      reserves: [
        makeReserve({ obligation_type: 'corporation-tax', lookahead_days: 365 }),
      ],
      obligations: [
        makeObligation({
          id: 'ct1',
          type: 'corporation-tax',
          name: 'CT FY 25/26',
          expectedAmount: 53000,
          dueDate: '2027-01-31',
        }),
      ],
      balanceByAccount: balances({ 'barclays-savings': 5000 }),
      monthlyContributionByAccount: contributions({}),
    });
    expect(out.find(o => o.code === 'tax-reserve-underfunded')).toBeDefined();
  });

  it('excludes CT beyond 90-day VAT lookahead when CT reserve uses 90', () => {
    const out = deriveTaxReserveWarnings({
      today: '2026-06-05',
      reserves: [
        makeReserve({ obligation_type: 'corporation-tax', lookahead_days: 90 }),
      ],
      obligations: [
        makeObligation({
          id: 'ct1',
          type: 'corporation-tax',
          expectedAmount: 53000,
          dueDate: '2027-01-31',
        }),
      ],
      balanceByAccount: balances({ 'barclays-savings': 0 }),
      monthlyContributionByAccount: contributions({}),
    });
    expect(out).toHaveLength(0);
  });

  it('includes overdue unpaid obligations', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [
        makeObligation({ expectedAmount: 10000, dueDate: '2025-12-01', status: 'unpaid' }),
      ],
      balanceByAccount: balances({ 'barclays-savings': 0 }),
      monthlyContributionByAccount: contributions({}),
    });
    const w = out.find(o => o.code === 'tax-reserve-underfunded');
    expect(w).toBeDefined();
    expect(w?.context?.dueDate).toBe('2025-12-01');
  });

  it('ignores overdue non-unpaid obligations', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [
        makeObligation({ expectedAmount: 10000, dueDate: '2025-12-01', status: 'not-yet-due' }),
      ],
      balanceByAccount: balances({ 'barclays-savings': 0 }),
      monthlyContributionByAccount: contributions({}),
    });
    expect(out).toHaveLength(0);
  });
});

describe('shared reserve account', () => {
  it('emits per-type underfunded for VAT and CT, not a combined pool warning', () => {
    const reserves: Reserve[] = [
      makeReserve({ obligation_type: 'vat', lookahead_days: 90 }),
      makeReserve({ obligation_type: 'corporation-tax', lookahead_days: 365 }),
    ];
    const obligations: ObligationRow[] = [
      makeObligation({ id: 'vat', type: 'vat', expectedAmount: 9000, dueDate: '2026-06-07' }),
      makeObligation({
        id: 'ct',
        type: 'corporation-tax',
        expectedAmount: 53000,
        dueDate: '2027-01-31',
      }),
    ];
    const out = deriveTaxReserveWarnings({
      today: '2026-06-05',
      reserves,
      obligations,
      balanceByAccount: balances({ 'barclays-savings': 5000 }),
      monthlyContributionByAccount: contributions({}),
    });
    const underfunded = out.filter(o => o.code === 'tax-reserve-underfunded');
    expect(underfunded).toHaveLength(2);
    expect(underfunded.map(w => w.context?.obligationType).sort()).toEqual([
      'corporation-tax',
      'vat',
    ]);
    expect(out.find(o => o.code === 'tax-reserve-pool-underfunded')).toBeUndefined();
  });
});

describe('maxReserveLookaheadDays', () => {
  it('returns the maximum configured lookahead across reserves', () => {
    expect(
      maxReserveLookaheadDays([
        makeReserve({ lookahead_days: 90 }),
        makeReserve({ obligation_type: 'corporation-tax', lookahead_days: 365 }),
      ]),
    ).toBe(365);
  });

  it('matches the exported default constant', () => {
    expect(RESERVE_LOOKAHEAD_DAYS).toBe(90);
  });
});
