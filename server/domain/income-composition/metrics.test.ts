import { describe, it, expect } from 'vitest';
import { computeIncomeComposition } from './metrics.js';
import type { IncomeSource } from './aggregator.js';
import type { CurrencyCode } from '../../../shared/api-contracts.js';

function src(over: Partial<IncomeSource> & { id: string; kind: IncomeSource['kind']; monthlyAmount: number }): IncomeSource {
  return {
    label: over.label ?? over.id,
    currency: over.currency ?? 'GBP',
    entityId: over.entityId ?? null,
    activityClass: over.activityClass ?? (over.kind === 'contract' ? 'active' : 'passive'),
    propertyId: over.propertyId ?? null,
    clientId: over.clientId ?? null,
    ...over,
  };
}

describe('computeIncomeComposition — single-currency single-contract case', () => {
  it('client concentration is 1.0 with one client', () => {
    const result = computeIncomeComposition({
      sources: [src({ id: 'c1', kind: 'contract', monthlyAmount: 10000, clientId: 'delta-capita', entityId: 'autonize-it-ltd' })],
      mandatoryMonthlyByCurrency: new Map([['GBP', 8000]]),
    });
    const gbp = result.household.GBP!;
    expect(gbp.clientConcentration.ratio).toBe(1);
    expect(gbp.clientConcentration.topClientId).toBe('delta-capita');
    expect(gbp.clientConcentration.topClientMonthly).toBe(10000);
    expect(gbp.clientConcentration.totalActiveMonthly).toBe(10000);
  });

  it('active/passive ratio is 0 when only active income exists', () => {
    const result = computeIncomeComposition({
      sources: [src({ id: 'c1', kind: 'contract', monthlyAmount: 10000, clientId: 'delta-capita' })],
      mandatoryMonthlyByCurrency: new Map([['GBP', 8000]]),
    });
    const gbp = result.household.GBP!;
    expect(gbp.activePassiveRatio.passiveMonthly).toBe(0);
    expect(gbp.activePassiveRatio.activeMonthly).toBe(10000);
    expect(gbp.activePassiveRatio.ratio).toBe(0);
  });

  it('time-independence ratio is passive / mandatory', () => {
    const result = computeIncomeComposition({
      sources: [
        src({ id: 'c1', kind: 'contract', monthlyAmount: 10000, clientId: 'delta-capita' }),
        src({ id: 'r1', kind: 'rental-income', monthlyAmount: 2000, propertyId: 'p' }),
      ],
      mandatoryMonthlyByCurrency: new Map([['GBP', 8000]]),
    });
    const gbp = result.household.GBP!;
    expect(gbp.timeIndependence.ratio).toBe(0.25); // 2000 / 8000
    expect(gbp.timeIndependence.passiveMonthly).toBe(2000);
    expect(gbp.timeIndependence.mandatoryMonthly).toBe(8000);
  });
});

describe('computeIncomeComposition — provenance of mandatoryMonthly', () => {
  it('mandatoryMonthly is exactly the value supplied for that currency (no parallel definition)', () => {
    const inputMandatory = new Map<CurrencyCode, number>([['GBP', 8765.43]]);
    const result = computeIncomeComposition({
      sources: [src({ id: 'r1', kind: 'rental-income', monthlyAmount: 2000 })],
      mandatoryMonthlyByCurrency: inputMandatory,
    });
    expect(result.household.GBP!.timeIndependence.mandatoryMonthly).toBe(8765.43);
  });
});

describe('computeIncomeComposition — per-currency no GBP+AED blend', () => {
  it('produces independent household entries for GBP and AED', () => {
    const result = computeIncomeComposition({
      sources: [
        src({ id: 'c1', kind: 'contract', monthlyAmount: 10000, currency: 'GBP', clientId: 'delta-capita', entityId: 'autonize-it-ltd' }),
        src({ id: 'c2', kind: 'contract', monthlyAmount: 4200, currency: 'AED', clientId: 'mce-advisory', entityId: 'autonize-it-fzco' }),
      ],
      mandatoryMonthlyByCurrency: new Map([['GBP', 5000], ['AED', 2000]]),
    });
    expect(result.household.GBP!.activePassiveRatio.totalMonthly).toBe(10000);
    expect(result.household.AED!.activePassiveRatio.totalMonthly).toBe(4200);
    // Drill-down has both entities/currencies separately
    expect(result.byEntity.length).toBeGreaterThanOrEqual(2);
  });
});

describe('computeIncomeComposition — per-entity drill-down differs from household', () => {
  it('UK Ltd entity sees only its own active income', () => {
    const result = computeIncomeComposition({
      sources: [
        src({ id: 'c1', kind: 'contract', monthlyAmount: 10000, currency: 'GBP', clientId: 'delta-capita', entityId: 'autonize-it-ltd' }),
        src({ id: 'r1', kind: 'rental-income', monthlyAmount: 2000, currency: 'GBP', entityId: null }),
      ],
      mandatoryMonthlyByCurrency: new Map([['GBP', 8000]]),
    });
    const ukLtd = result.byEntity.find(s => s.entityId === 'autonize-it-ltd' && s.currency === 'GBP');
    expect(ukLtd).toBeDefined();
    expect(ukLtd!.metrics.activePassiveRatio.activeMonthly).toBe(10000);
    expect(ukLtd!.metrics.activePassiveRatio.passiveMonthly).toBe(0);

    const personal = result.byEntity.find(s => s.entityId === null && s.currency === 'GBP');
    expect(personal).toBeDefined();
    expect(personal!.metrics.activePassiveRatio.passiveMonthly).toBe(2000);
  });
});

describe('computeIncomeComposition — primitives travel with each metric', () => {
  it('every metric carries its numerator and denominator (no derived-only output)', () => {
    const result = computeIncomeComposition({
      sources: [
        src({ id: 'c1', kind: 'contract', monthlyAmount: 8000, clientId: 'delta-capita' }),
        src({ id: 'c2', kind: 'contract', monthlyAmount: 2000, clientId: 'la-fosse' }),
        src({ id: 'r1', kind: 'rental-income', monthlyAmount: 1500 }),
      ],
      mandatoryMonthlyByCurrency: new Map([['GBP', 7000]]),
    });
    const m = result.household.GBP!;
    // ClientConcentration carries top + total
    expect(m.clientConcentration.topClientId).toBe('delta-capita');
    expect(m.clientConcentration.topClientMonthly).toBe(8000);
    expect(m.clientConcentration.totalActiveMonthly).toBe(10000);
    // ActivePassive carries all three sums + per-kind split
    expect(m.activePassiveRatio.activeMonthly).toBe(10000);
    expect(m.activePassiveRatio.passiveMonthly).toBe(1500);
    expect(m.activePassiveRatio.totalMonthly).toBe(11500);
    expect(m.activePassiveRatio.passiveByKind['rental-income']).toBe(1500);
    // TimeIndependence carries passive + mandatory
    expect(m.timeIndependence.passiveMonthly).toBe(1500);
    expect(m.timeIndependence.mandatoryMonthly).toBe(7000);
  });
});
