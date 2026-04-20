import { describe, it, expect } from 'vitest';
import { DeclaredOutgoingSchema } from '../../../shared/api-contracts.js';
import {
  commitmentProjectsToObligation,
  obligationTypeForCommitment,
  projectCommitmentToObligationRow,
} from './obligation-projection.js';

const baseTaxManual = {
  id: 'manual-test-vat',
  category: 'tax-manual' as const,
  cadence: 'quarterly' as const,
  merchant: 'HMRC',
  displayName: 'VAT Q1 2026',
  amount: 1500,
  currency: 'GBP' as const,
  dueDate: '2026-05-07',
};

describe('obligationTypeForCommitment', () => {
  it('preserves the tax subtype round-trip when taxType is set', () => {
    for (const taxType of ['vat', 'corporation-tax', 'self-assessment', 'hmrc-ttp'] as const) {
      const commitment = DeclaredOutgoingSchema.parse({ ...baseTaxManual, taxType });
      if (commitment.category !== 'tax-manual') throw new Error('guard');
      expect(obligationTypeForCommitment(commitment)).toBe(taxType);
    }
  });

  it('falls back to self-assessment when taxType is absent (legacy rows)', () => {
    const commitment = DeclaredOutgoingSchema.parse({ ...baseTaxManual });
    if (commitment.category !== 'tax-manual') throw new Error('guard');
    expect(obligationTypeForCommitment(commitment)).toBe('self-assessment');
  });

  it('uses category as the type for non-tax projections', () => {
    const insurance = DeclaredOutgoingSchema.parse({
      id: 'manual-ins', category: 'insurance', cadence: 'annual',
      merchant: 'Orient', displayName: 'Prof Indemnity', amount: 25200,
      currency: 'AED', dueDate: '2027-03-27',
    });
    if (insurance.category !== 'insurance') throw new Error('guard');
    expect(obligationTypeForCommitment(insurance)).toBe('insurance');
  });
});

describe('projectCommitmentToObligationRow', () => {
  it('stamps the taxType subtype onto the projected row', () => {
    const commitment = DeclaredOutgoingSchema.parse({ ...baseTaxManual, taxType: 'vat' });
    if (!commitmentProjectsToObligation(commitment)) throw new Error('guard');
    const row = projectCommitmentToObligationRow(commitment, undefined);
    expect(row.type).toBe('vat');
    expect(row.dueDate).toBe('2026-05-07');
    expect(row.expectedAmount).toBe(1500);
  });
});
