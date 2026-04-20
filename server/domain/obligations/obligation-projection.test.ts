import { describe, it, expect } from 'vitest';
import { OutgoingObligationSchema } from '../../../shared/api-contracts.js';
import {
  obligationProjectsToRow,
  obligationTypeForRow,
  projectObligationToRow,
} from './obligation-projection.js';

const baseTaxManual = {
  id: 'manual-test-vat',
  category: 'tax-manual' as const,
  frequency: 'quarterly' as const,
  merchant: 'HMRC',
  displayName: 'VAT Q1 2026',
  amount: 1500,
  currency: 'GBP' as const,
  dueDate: '2026-05-07',
};

describe('obligationTypeForRow', () => {
  it('preserves the tax subtype round-trip when taxType is set', () => {
    for (const taxType of ['vat', 'corporation-tax', 'self-assessment', 'hmrc-ttp'] as const) {
      const obligation = OutgoingObligationSchema.parse({ ...baseTaxManual, taxType });
      if (obligation.category !== 'tax-manual') throw new Error('guard');
      expect(obligationTypeForRow(obligation)).toBe(taxType);
    }
  });

  it('falls back to self-assessment when taxType is absent (legacy rows)', () => {
    const obligation = OutgoingObligationSchema.parse({ ...baseTaxManual });
    if (obligation.category !== 'tax-manual') throw new Error('guard');
    expect(obligationTypeForRow(obligation)).toBe('self-assessment');
  });

  it('uses category as the type for non-tax projections', () => {
    const insurance = OutgoingObligationSchema.parse({
      id: 'manual-ins', category: 'insurance', frequency: 'annual',
      merchant: 'Orient', displayName: 'Prof Indemnity', amount: 25200,
      currency: 'AED', dueDate: '2027-03-27',
    });
    if (insurance.category !== 'insurance') throw new Error('guard');
    expect(obligationTypeForRow(insurance)).toBe('insurance');
  });
});

describe('projectObligationToRow', () => {
  it('stamps the taxType subtype onto the projected row', () => {
    const obligation = OutgoingObligationSchema.parse({ ...baseTaxManual, taxType: 'vat' });
    if (!obligationProjectsToRow(obligation)) throw new Error('guard');
    const row = projectObligationToRow(obligation, undefined);
    expect(row.type).toBe('vat');
    expect(row.dueDate).toBe('2026-05-07');
    expect(row.expectedAmount).toBe(1500);
  });
});
