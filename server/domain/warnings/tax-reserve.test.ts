import { describe, it, expect } from 'vitest';
import {
  deriveTaxReserveWarnings,
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
    // 90 days = ~3 months. £1000/mo contribution → +£3000. Start at £4000 → £7000 projected. Liability £10000 → gap £3000.
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

  it('does NOT fire when balance is already over liability (underfunded check has priority)', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [makeObligation({ expectedAmount: 5000, dueDate: '2026-04-15' })],
      balanceByAccount: balances({ 'barclays-savings': 6000 }),
      monthlyContributionByAccount: contributions({ 'barclays-savings': 1000 }),
    });
    expect(out.find(o => o.code === 'tax-reserve-trajectory-missing')).toBeUndefined();
  });

  it('can fire alongside underfunded (alternative remedies for the same reserve)', () => {
    // £1000 today + £100/mo over ~1.5 months ≈ £1150 vs £10000 liability — both checks bite.
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [makeObligation({ expectedAmount: 10000 })],
      balanceByAccount: balances({ 'barclays-savings': 1000 }),
      monthlyContributionByAccount: contributions({ 'barclays-savings': 100 }),
    });
    expect(out.filter(o => o.code === 'tax-reserve-underfunded')).toHaveLength(1);
    expect(out.filter(o => o.code === 'tax-reserve-trajectory-missing')).toHaveLength(1);
  });
});

describe('missing reserve → no warning (config gap, not violation)', () => {
  it('emits nothing when no reserve is configured for the obligation type/entity', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [], // no reserves configured
      obligations: [makeObligation({ expectedAmount: 10000 })],
      balanceByAccount: balances({ 'barclays-savings': 0 }),
      monthlyContributionByAccount: contributions({}),
    });
    expect(out).toHaveLength(0);
  });

  it('emits nothing for obligations whose entity is unknown', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [makeObligation({ entity: 'mystery-entity' })],
      balanceByAccount: balances({}),
      monthlyContributionByAccount: contributions({}),
    });
    expect(out).toHaveLength(0);
  });
});

describe('window filtering', () => {
  it('ignores obligations due past the lookahead window', () => {
    const farFuture = '2027-12-31';
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [makeObligation({ expectedAmount: 10000, dueDate: farFuture })],
      balanceByAccount: balances({ 'barclays-savings': 0 }),
      monthlyContributionByAccount: contributions({}),
    });
    expect(out).toHaveLength(0);
  });

  it('ignores already-overdue obligations (handled by overdue hero, not the warning spine)', () => {
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: [makeObligation({ expectedAmount: 10000, dueDate: '2025-12-01' })],
      balanceByAccount: balances({ 'barclays-savings': 0 }),
      monthlyContributionByAccount: contributions({}),
    });
    expect(out).toHaveLength(0);
  });

  it('uses the earliest due date when multiple obligations cover the same reserve', () => {
    const fxs: ObligationRow[] = [
      makeObligation({ id: 'o1', expectedAmount: 5000, dueDate: '2026-04-15' }),
      makeObligation({ id: 'o2', expectedAmount: 5000, dueDate: '2026-02-15' }),
    ];
    const out = deriveTaxReserveWarnings({
      today,
      reserves: [makeReserve()],
      obligations: fxs,
      balanceByAccount: balances({ 'barclays-savings': 0 }),
      monthlyContributionByAccount: contributions({}),
    });
    const w = out.find(o => o.code === 'tax-reserve-underfunded');
    expect(w?.context?.dueDate).toBe('2026-02-15');
    expect(w?.context?.liability).toBe(10000);
  });
});

describe('per-entity scoping', () => {
  it('UK Ltd VAT and FZCO VAT emit independent warnings', () => {
    const reserves: Reserve[] = [
      makeReserve({ entity_id: 'autonize-it-ltd', reserve_account: 'barclays-savings' }),
      makeReserve({ entity_id: 'autonize-it-fzco', reserve_account: 'emirates-islamic' }),
    ];
    const obligations: ObligationRow[] = [
      makeObligation({ id: 'uk', entity: 'autonize-it-ltd', expectedAmount: 10000 }),
      makeObligation({ id: 'fz', entity: 'autonize-it-fzco', expectedAmount: 5000 }),
    ];
    const out = deriveTaxReserveWarnings({
      today,
      reserves,
      obligations,
      balanceByAccount: balances({ 'barclays-savings': 0, 'emirates-islamic': 0 }),
      monthlyContributionByAccount: contributions({}),
    });
    const uk = out.find(o => o.entityId === 'autonize-it-ltd');
    const fzco = out.find(o => o.entityId === 'autonize-it-fzco');
    expect(uk).toBeDefined();
    expect(fzco).toBeDefined();
    expect(uk?.context?.liability).toBe(10000);
    expect(fzco?.context?.liability).toBe(5000);
  });
});

describe('lookahead default', () => {
  it('matches the exported constant', () => {
    expect(RESERVE_LOOKAHEAD_DAYS).toBe(90);
  });
});
