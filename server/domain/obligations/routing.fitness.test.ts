/**
 * Architectural fitness tests for obligation routing (ADR 0001 §7).
 *
 * These tests lock in the canonical routing rules by enumerating every
 * category in the discriminated union and asserting the named view
 * filters agree with the decisions documented in the ADR. They are
 * deliberately independent of the production registry so a seed-row
 * change never turns the fitness check into a regression detector.
 */

import { describe, it, expect } from 'vitest';
import {
  IncomingObligationSchema,
  OutgoingObligationSchema,
  type IncomingObligationCategory,
  type OutgoingObligationCategory,
  type OutgoingObligation,
  type IncomingObligation,
} from '../../../shared/api-contracts.js';
import {
  obligationProjectsToRow,
  showOnObligationsTab,
} from './obligation-projection.js';
import { showOnFixedExpenses } from '../../utils/recurring-pipeline.js';
import { getObligationRegistry } from './registry.js';
import { categorizeTransaction } from '../../utils/categorizer.js';
import { SPECIAL_CATEGORY } from '../../utils/category-constants.js';

const INCOMING_CATEGORIES: readonly IncomingObligationCategory[] = [
  'rental-income',
];
const OUTGOING_CATEGORIES: readonly OutgoingObligationCategory[] = [
  'fixed-bill',
  'subscription',
  'payroll',
  'insurance',
  'tax-manual',
];

// Schema-valid fixtures — parsed through Zod so the tests stay honest
// about the real shape of each variant and we never reach for a type
// cast. Per-category overrides cover the fields required by the
// variant-specific extensions.
function outgoingFixture(category: OutgoingObligationCategory): OutgoingObligation {
  const base = {
    id: `fixture-${category}`,
    frequency: 'monthly',
    merchant: 'Test Merchant',
    amount: 100,
    currency: 'GBP',
  };
  switch (category) {
    case 'fixed-bill':
    case 'subscription':
    case 'insurance':
      return OutgoingObligationSchema.parse({ ...base, category });
    case 'payroll':
      return OutgoingObligationSchema.parse({ ...base, category, personId: 'david' });
    case 'tax-manual':
      return OutgoingObligationSchema.parse({ ...base, category, taxType: 'vat' });
  }
}

function incomingFixture(category: IncomingObligationCategory): IncomingObligation {
  switch (category) {
    case 'rental-income':
      return IncomingObligationSchema.parse({
        id: `fixture-${category}`,
        category,
        frequency: 'monthly',
        merchant: 'Test Tenant',
        amount: 1000,
        currency: 'GBP',
        ownership: { david: 0.5, heena: 0.5 },
      });
  }
}

describe('routing fitness — category enumeration is exhaustive', () => {
  it('outgoing schema lists exactly the enumerated categories', () => {
    const schemaCategories = new Set(
      OutgoingObligationSchema.options.map(opt => opt.shape.category.value),
    );
    expect(schemaCategories).toEqual(new Set(OUTGOING_CATEGORIES));
  });

  it('incoming schema lists exactly the enumerated categories', () => {
    const schemaCategories = new Set(
      IncomingObligationSchema.options.map(opt => opt.shape.category.value),
    );
    expect(schemaCategories).toEqual(new Set(INCOMING_CATEGORIES));
  });
});

describe('routing fitness — every outgoing category surfaces somewhere', () => {
  it('every outgoing category is routed to at least one view', () => {
    for (const category of OUTGOING_CATEGORIES) {
      const c = outgoingFixture(category);
      const surfaced = showOnFixedExpenses(c) || showOnObligationsTab(c);
      expect(surfaced, `outgoing category "${category}" is not routed to any view`).toBe(true);
    }
  });
});

describe('routing fitness — documented invariants', () => {
  it('tax-manual never surfaces on Fixed Expenses', () => {
    expect(showOnFixedExpenses(outgoingFixture('tax-manual'))).toBe(false);
  });

  it('payroll never surfaces on the Obligations tab', () => {
    expect(showOnObligationsTab(outgoingFixture('payroll'))).toBe(false);
    expect(obligationProjectsToRow(outgoingFixture('payroll'))).toBe(false);
  });

  it('fixed-bill never surfaces on the Obligations tab', () => {
    expect(showOnObligationsTab(outgoingFixture('fixed-bill'))).toBe(false);
    expect(obligationProjectsToRow(outgoingFixture('fixed-bill'))).toBe(false);
  });

  it('insurance surfaces on both views', () => {
    expect(showOnFixedExpenses(outgoingFixture('insurance'))).toBe(true);
    expect(showOnObligationsTab(outgoingFixture('insurance'))).toBe(true);
  });

  it('subscription surfaces on both views', () => {
    expect(showOnFixedExpenses(outgoingFixture('subscription'))).toBe(true);
    expect(showOnObligationsTab(outgoingFixture('subscription'))).toBe(true);
  });

  it('rental-income never projects to the Obligations tab (incoming)', () => {
    expect(obligationProjectsToRow(incomingFixture('rental-income'))).toBe(false);
  });
});

describe('routing fitness — registry + heuristic agreement', () => {
  it('every rental-income obligation merchant classifies as Property', () => {
    const registry = getObligationRegistry();
    const rentals = registry.listByCategory('rental-income');
    expect(rentals.length).toBeGreaterThan(0);
    for (const r of rentals) {
      expect(categorizeTransaction(r.merchant)).toBe(SPECIAL_CATEGORY.property);
    }
  });

  it('no obligation id collides across the registry', () => {
    const registry = getObligationRegistry();
    const ids = registry.all.map(o => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
