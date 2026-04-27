/**
 * Unit tests for `buildPropertyLeverageInputs`.
 *
 * Lock the §1.7/§1.8 contract:
 *   - `debt.matchAmounts[0]` IS the leverage signal's monthly mortgage cost.
 *   - Two mortgages sharing a `merchant_pattern` produce TWO distinct
 *     leverage inputs (regression lock for the original blending bug
 *     where summing the recurring pipeline by merchant pattern blended
 *     hunters + thorney into "£1,687/mo" instead of distinct payments).
 *   - Multiple rentals on a single property sum to one combined gross.
 *   - Properties without rentals OR without mortgages emit no input.
 *   - Archived mortgages are skipped.
 */

import { describe, it, expect } from 'vitest';
import { buildPropertyLeverageInputs } from './assemble.js';
import type { Debt } from '../../db/repositories/debts.js';

function makeMortgage(over: Partial<Debt> & Pick<Debt, 'propertyId' | 'matchAmounts'>): Debt {
  return {
    id: over.id ?? 'm',
    name: over.name ?? 'Mortgage',
    merchantPattern: over.merchantPattern ?? 'NatWest',
    sourceAccounts: over.sourceAccounts ?? ['monzo-joint'],
    originalLoanAmount: over.originalLoanAmount ?? 100_000,
    originalLoanDate: over.originalLoanDate ?? null,
    openingBalance: over.openingBalance ?? 100_000,
    openingBalanceDate: over.openingBalanceDate ?? '2024-01-01',
    archived: over.archived ?? false,
    matchAmounts: over.matchAmounts,
    matchTolerancePct: over.matchTolerancePct ?? 0,
    kind: over.kind ?? 'mortgage',
    interestRate: over.interestRate ?? 4,
    fixedRateEndDate: over.fixedRateEndDate ?? null,
    repaymentType: over.repaymentType ?? 'interest-only',
    propertyValueEstimate: over.propertyValueEstimate ?? 200_000,
    propertyId: over.propertyId,
    updatedAt: over.updatedAt ?? '2026-01-01T00:00:00Z',
  };
}

describe('buildPropertyLeverageInputs', () => {
  it('uses matchAmounts[0] as the contractual monthly (NOT a sum of the array)', () => {
    const out = buildPropertyLeverageInputs({
      rentals: [{ propertyId: 'hunters-square-78', amount: 1292.72 }],
      debts: [
        makeMortgage({
          id: 'mortgage-hunters',
          merchantPattern: 'NatWest',
          matchAmounts: [801.35, 1054.64, 306.35], // current, stress, fee
          propertyId: 'hunters-square-78',
        }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].mortgageMonthly).toBe(801.35);
    expect(out[0].grossMonthly).toBe(1292.72);
    expect(out[0].propertyId).toBe('hunters-square-78');
  });

  it('REGRESSION: two mortgages with the same merchant_pattern produce TWO distinct leverage inputs', () => {
    // Original bug: `mortgageMonthlyCash('NatWest')` summed the recurring
    // pipeline's NatWest matches, blending Hunters and Thorney into one
    // £1,687/mo figure. With matchAmounts[0] each property gets its own
    // monthly cost.
    const out = buildPropertyLeverageInputs({
      rentals: [
        { propertyId: 'hunters-square-78', amount: 1292.72 },
        { propertyId: 'thorney-house-56', amount: 1100.00 },
      ],
      debts: [
        makeMortgage({
          id: 'mortgage-hunters',
          merchantPattern: 'NatWest',
          matchAmounts: [801.35],
          propertyId: 'hunters-square-78',
        }),
        makeMortgage({
          id: 'mortgage-thorney',
          merchantPattern: 'NatWest',
          matchAmounts: [683.38],
          propertyId: 'thorney-house-56',
        }),
      ],
    });
    expect(out).toHaveLength(2);
    const hunters = out.find(o => o.propertyId === 'hunters-square-78')!;
    const thorney = out.find(o => o.propertyId === 'thorney-house-56')!;
    expect(hunters.mortgageMonthly).toBe(801.35);
    expect(thorney.mortgageMonthly).toBe(683.38);
  });

  it('sums multiple rentals on the same property', () => {
    const out = buildPropertyLeverageInputs({
      rentals: [
        { propertyId: 'p1', amount: 800 },
        { propertyId: 'p1', amount: 200 },
      ],
      debts: [
        makeMortgage({ id: 'm1', matchAmounts: [600], propertyId: 'p1' }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].grossMonthly).toBe(1000);
    expect(out[0].mortgageMonthly).toBe(600);
  });

  it('skips properties with no rental obligation', () => {
    const out = buildPropertyLeverageInputs({
      rentals: [],
      debts: [
        makeMortgage({ id: 'm1', matchAmounts: [600], propertyId: 'p1' }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('skips rentals on properties with no mortgage', () => {
    const out = buildPropertyLeverageInputs({
      rentals: [{ propertyId: 'p1', amount: 1000 }],
      debts: [],
    });
    expect(out).toHaveLength(0);
  });

  it('skips archived mortgages', () => {
    const out = buildPropertyLeverageInputs({
      rentals: [{ propertyId: 'p1', amount: 1000 }],
      debts: [
        makeMortgage({
          id: 'm1',
          matchAmounts: [600],
          propertyId: 'p1',
          archived: true,
        }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('skips non-mortgage debts (consumer loans against a property are not leverage signals)', () => {
    const out = buildPropertyLeverageInputs({
      rentals: [{ propertyId: 'p1', amount: 1000 }],
      debts: [
        makeMortgage({
          id: 'm1',
          matchAmounts: [600],
          propertyId: 'p1',
          kind: 'consumer',
        }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('skips mortgages with no propertyId', () => {
    const out = buildPropertyLeverageInputs({
      rentals: [{ propertyId: 'p1', amount: 1000 }],
      debts: [
        makeMortgage({
          id: 'm1',
          matchAmounts: [600],
          propertyId: null,
        }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('does NOT sum the matchAmounts array (defensive: even with multiple values it picks index 0 only)', () => {
    const out = buildPropertyLeverageInputs({
      rentals: [{ propertyId: 'p1', amount: 1000 }],
      debts: [
        makeMortgage({ id: 'm1', matchAmounts: [500, 999, 1000], propertyId: 'p1' }),
      ],
    });
    expect(out[0].mortgageMonthly).toBe(500);
    // If summing were happening, it would be 2499 — that's the original bug shape.
  });
});
