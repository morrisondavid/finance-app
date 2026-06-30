/**
 * Contract test for GET /api/tax/overview read composer.
 */

import { describe, it, expect } from 'vitest';
import { usePopulatedIntegrationDatabase } from '../../db/test-harness/use-populated-integration-db.js';
import { TaxOverviewResponseSchema } from '../../../shared/api-contracts.js';
import { getUpcomingObligations, toApiObligation } from '../../db/repositories/obligations.js';
import { readTaxOverview } from './tax-read.js';

describe('readTaxOverview', () => {
  usePopulatedIntegrationDatabase(import.meta.url);

  it('returns UK + FZCO entity panels and separate selfAssessment with expected line kinds', () => {
    const result = readTaxOverview();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = TaxOverviewResponseSchema.parse(result.body);
    expect(parsed.entities.length).toBe(2);

    const uk = parsed.entities.find(e => e.entityId === 'autonize-it-ltd');
    const fzco = parsed.entities.find(e => e.entityId === 'autonize-it-fzco');
    expect(uk).toBeDefined();
    expect(fzco).toBeDefined();

    expect(uk?.lines.some(l => l.kind === 'vat')).toBe(true);
    expect(uk?.lines.some(l => l.kind === 'corporation-tax')).toBe(true);
    expect(uk?.lines.some(l => l.kind === 'self-assessment')).toBe(false);

    expect(parsed.selfAssessment.lines.length).toBe(2);
    expect(parsed.selfAssessment.lines.every(l => l.kind === 'self-assessment')).toBe(true);
    expect(parsed.selfAssessment.lines.some(l => l.label.includes('David'))).toBe(true);
    expect(parsed.selfAssessment.lines.some(l => l.label.includes('Heena'))).toBe(true);

    expect(fzco?.lines.some(l => l.kind === 'ct-scenario')).toBe(true);
    expect(fzco?.lines.filter(l => l.kind === 'ct-scenario').length).toBeGreaterThanOrEqual(2);
    expect(fzco?.lines.some(l => l.kind === 'vat-threshold-tracker')).toBe(true);

    expect(parsed.combinedGbpTotal).toBeGreaterThanOrEqual(0);
  });

  it('UK CT line matches the canonical auto-seeded obligation, not an all-time sum', () => {
    const result = readTaxOverview();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = TaxOverviewResponseSchema.parse(result.body);
    const uk = parsed.entities.find(e => e.entityId === 'autonize-it-ltd');
    expect(uk).toBeDefined();
    if (uk === undefined) return;

    const ctLine = uk.lines.find(l => l.kind === 'corporation-tax');
    expect(ctLine).toBeDefined();
    if (ctLine === undefined) return;

    const ctObligation = getUpcomingObligations(365)
      .map(toApiObligation)
      .filter(o => o.entity === 'autonize-it-ltd' && o.type === 'corporation-tax' && o.status !== 'paid')
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0];

    expect(ctObligation).toBeDefined();
    if (ctObligation === undefined) return;

    expect(ctLine.amount).toBe(ctObligation.expectedAmount);
    expect(ctLine.detail).not.toMatch(/2500/);
    expect(ctLine.amount).toBeLessThan(100_000);
  });

  it('SA lines match nearest upcoming auto-seeded obligations when present', () => {
    const result = readTaxOverview();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = TaxOverviewResponseSchema.parse(result.body);
    const saObligations = getUpcomingObligations(365)
      .map(toApiObligation)
      .filter(
        o =>
          o.entity === 'autonize-it-ltd'
          && o.type === 'self-assessment'
          && o.status !== 'paid'
          && o.personId !== null,
      );

    for (const personId of ['david', 'heena'] as const) {
      const line = parsed.selfAssessment.lines.find(l => l.label.toLowerCase().includes(personId));
      expect(line).toBeDefined();
      if (line === undefined) continue;

      const obligation = saObligations
        .filter(o => o.personId === personId)
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0];

      if (obligation !== undefined && obligation.expectedAmount !== null) {
        expect(line.amount).toBe(obligation.expectedAmount);
      }
    }
  });

  it('headline totals exclude SA from UK Ltd and combinedGbpTotal sums all panels', () => {
    const result = readTaxOverview();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = TaxOverviewResponseSchema.parse(result.body);
    const uk = parsed.entities.find(e => e.entityId === 'autonize-it-ltd');
    const fzco = parsed.entities.find(e => e.entityId === 'autonize-it-fzco');
    expect(uk).toBeDefined();
    expect(fzco).toBeDefined();
    if (uk === undefined || fzco === undefined) return;

    const ukLineSum = uk.lines.reduce((sum, l) => sum + (l.amount ?? 0), 0);
    expect(uk.headlineTotal).toBeCloseTo(ukLineSum, 2);
    expect(uk.lines.some(l => l.kind === 'self-assessment')).toBe(false);

    const saLineSum = parsed.selfAssessment.lines.reduce((sum, l) => sum + (l.amount ?? 0), 0);
    expect(parsed.selfAssessment.headlineTotal).toBeCloseTo(saLineSum, 2);

    const expectedCombined = uk.headlineTotalGbp + parsed.selfAssessment.headlineTotal + fzco.headlineTotalGbp;
    expect(parsed.combinedGbpTotal).toBeCloseTo(expectedCombined, 2);
  });

  it('FZCO panel includes account-balance lines for Emirates Islamic accounts', () => {
    const result = readTaxOverview();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = TaxOverviewResponseSchema.parse(result.body);
    const fzco = parsed.entities.find(e => e.entityId === 'autonize-it-fzco');
    expect(fzco).toBeDefined();
    if (fzco === undefined) return;

    const balanceLines = fzco.lines.filter(l => l.kind === 'account-balance');
    expect(balanceLines.length).toBeGreaterThanOrEqual(3);
    expect(balanceLines.some(l => l.label.includes('Emirates Islamic'))).toBe(true);

    const ctLines = fzco.lines.filter(l => l.kind === 'ct-scenario');
    for (const line of ctLines) {
      if (line.amount === 0 && line.detail !== null) {
        expect(line.detail.toLowerCase()).toMatch(/below|threshold|0%/);
      }
    }
  });
});
