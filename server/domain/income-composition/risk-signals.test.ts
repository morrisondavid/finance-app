import { describe, it, expect } from 'vitest';
import {
  computeRiskSignals,
  CLIENT_CONCENTRATION_EXTREME,
  CLIENT_CONCENTRATION_ELEVATED,
  TIME_INDEPENDENCE_LOW,
  TIME_INDEPENDENCE_TARGET,
  LEVERAGED_PASSIVE_HIGH,
  LEVERAGED_PASSIVE_MEDIUM,
} from './risk-signals.js';
import type { IncomeCompositionMetrics } from './metrics.js';

function metrics(over: {
  cc?: { ratio: number; topClientId: string | null; topClientMonthly: number; totalActiveMonthly: number };
  ap?: { ratio: number; passiveMonthly: number; activeMonthly: number; totalMonthly: number };
  ti?: { ratio: number; passiveMonthly: number; mandatoryMonthly: number };
}): IncomeCompositionMetrics {
  const emptyByKind = { contract: 0, 'rental-income': 0, 'recurring-detected': 0 } as const;
  return {
    clientConcentration: over.cc ?? {
      ratio: 0,
      topClientId: null,
      topClientMonthly: 0,
      totalActiveMonthly: 0,
    },
    activePassiveRatio: over.ap !== undefined
      ? { ...over.ap, passiveByKind: { ...emptyByKind } }
      : {
          ratio: 0,
          passiveMonthly: 0,
          activeMonthly: 0,
          totalMonthly: 0,
          passiveByKind: { ...emptyByKind },
        },
    timeIndependence: over.ti ?? { ratio: 0, passiveMonthly: 0, mandatoryMonthly: 0 },
  };
}

describe('client concentration signals', () => {
  it('emits extreme/high when ratio ≥ 0.8', () => {
    const signals = computeRiskSignals({
      householdMetrics: {
        GBP: metrics({
          cc: { ratio: 1.0, topClientId: 'delta-capita', topClientMonthly: 10000, totalActiveMonthly: 10000 },
        }),
      },
      propertyLeverage: [],
    });
    const cc = signals.find(s => s.code === 'client-concentration-extreme');
    expect(cc).toBeDefined();
    if (cc?.code !== 'client-concentration-extreme') throw new Error('narrow');
    expect(cc.severity).toBe('high');
    expect(cc.threshold).toBe(CLIENT_CONCENTRATION_EXTREME);
    expect(cc.topClientId).toBe('delta-capita');
    expect(cc.totalActiveMonthly).toBe(10000);
  });

  it('emits elevated/medium when ratio in [0.5, 0.8)', () => {
    const signals = computeRiskSignals({
      householdMetrics: {
        GBP: metrics({
          cc: { ratio: 0.7, topClientId: 'delta-capita', topClientMonthly: 7000, totalActiveMonthly: 10000 },
        }),
      },
      propertyLeverage: [],
    });
    const cc = signals.find(s => s.code === 'client-concentration-elevated');
    expect(cc).toBeDefined();
    if (cc?.code !== 'client-concentration-elevated') throw new Error('narrow');
    expect(cc.severity).toBe('medium');
    expect(cc.threshold).toBe(CLIENT_CONCENTRATION_ELEVATED);
  });

  it('does not emit when ratio < 0.5', () => {
    const signals = computeRiskSignals({
      householdMetrics: {
        GBP: metrics({
          cc: { ratio: 0.3, topClientId: 'delta-capita', topClientMonthly: 3000, totalActiveMonthly: 10000 },
        }),
      },
      propertyLeverage: [],
    });
    expect(signals.filter(s => s.code.startsWith('client-concentration'))).toHaveLength(0);
  });
});

describe('time-independence signals', () => {
  it('emits low/high with reduction-target math', () => {
    const signals = computeRiskSignals({
      householdMetrics: {
        GBP: metrics({
          ti: { ratio: 0.07, passiveMonthly: 700, mandatoryMonthly: 10000 },
        }),
      },
      propertyLeverage: [],
    });
    const ti = signals.find(s => s.code === 'time-independence-low');
    expect(ti).toBeDefined();
    if (ti?.code !== 'time-independence-low') throw new Error('narrow');
    expect(ti.severity).toBe('high');
    expect(ti.targetRatio).toBe(TIME_INDEPENDENCE_TARGET);
    // additionalPassiveNeeded = 0.5 * 10000 - 700 = 4300
    expect(ti.additionalPassiveNeeded).toBe(4300);
    // mandatoryReductionNeeded = 10000 - 700 / 0.5 = 8600
    expect(ti.mandatoryReductionNeeded).toBe(8600);
  });

  it('does not emit when ratio ≥ elevated threshold', () => {
    const signals = computeRiskSignals({
      householdMetrics: {
        GBP: metrics({
          ti: { ratio: 0.6, passiveMonthly: 6000, mandatoryMonthly: 10000 },
        }),
      },
      propertyLeverage: [],
    });
    expect(signals.filter(s => s.code.startsWith('time-independence'))).toHaveLength(0);
  });

  it('threshold at the boundary', () => {
    expect(TIME_INDEPENDENCE_LOW).toBe(0.25);
  });
});

describe('mode-concentration signals', () => {
  it('emits extreme/high when active share ≥ 0.9', () => {
    const signals = computeRiskSignals({
      householdMetrics: {
        GBP: metrics({
          ap: {
            ratio: 0.05,
            passiveMonthly: 500,
            activeMonthly: 10000,
            totalMonthly: 10500,
          },
        }),
      },
      propertyLeverage: [],
    });
    const mc = signals.find(s => s.code === 'mode-concentration-extreme');
    expect(mc).toBeDefined();
    if (mc?.code !== 'mode-concentration-extreme') throw new Error('narrow');
    expect(mc.severity).toBe('high');
    expect(mc.activeShare).toBeGreaterThan(0.9);
  });
});

describe('passive-income-zero signal', () => {
  it('fires when passive is zero AND there is income AND there are bills', () => {
    const signals = computeRiskSignals({
      householdMetrics: {
        GBP: metrics({
          ap: {
            ratio: 0,
            passiveMonthly: 0,
            activeMonthly: 10000,
            totalMonthly: 10000,
          },
          ti: { ratio: 0, passiveMonthly: 0, mandatoryMonthly: 5000 },
        }),
      },
      propertyLeverage: [],
    });
    const z = signals.find(s => s.code === 'passive-income-zero');
    expect(z).toBeDefined();
  });
});

describe('leveraged-passive-income (per-property)', () => {
  it('high severity when net/gross < 0.3', () => {
    const signals = computeRiskSignals({
      householdMetrics: {},
      propertyLeverage: [
        { propertyId: 'hunters-square-78', grossMonthly: 1000, mortgageMonthly: 800 },
      ],
    });
    const lev = signals.find(s => s.code === 'leveraged-passive-income');
    expect(lev).toBeDefined();
    if (lev?.code !== 'leveraged-passive-income') throw new Error('narrow');
    expect(lev.severity).toBe('high');
    expect(lev.propertyId).toBe('hunters-square-78');
    expect(lev.grossMonthly).toBe(1000);
    expect(lev.mortgageMonthly).toBe(800);
    expect(lev.netMonthly).toBe(200);
    expect(lev.netToGrossRatio).toBe(0.2);
    expect(lev.threshold).toBe(LEVERAGED_PASSIVE_HIGH);
  });

  it('medium severity when 0.3 ≤ net/gross < 0.5', () => {
    const signals = computeRiskSignals({
      householdMetrics: {},
      propertyLeverage: [
        { propertyId: 'p', grossMonthly: 1000, mortgageMonthly: 600 },
      ],
    });
    const lev = signals.find(s => s.code === 'leveraged-passive-income');
    expect(lev).toBeDefined();
    if (lev?.code !== 'leveraged-passive-income') throw new Error('narrow');
    expect(lev.severity).toBe('medium');
    expect(lev.threshold).toBe(LEVERAGED_PASSIVE_MEDIUM);
  });

  it('does not emit when net/gross ≥ 0.5', () => {
    const signals = computeRiskSignals({
      householdMetrics: {},
      propertyLeverage: [
        { propertyId: 'p', grossMonthly: 1000, mortgageMonthly: 400 },
      ],
    });
    expect(signals.filter(s => s.code === 'leveraged-passive-income')).toHaveLength(0);
  });
});

describe('healthy state — no signals fire', () => {
  it('returns an empty array', () => {
    const signals = computeRiskSignals({
      householdMetrics: {
        GBP: metrics({
          cc: { ratio: 0.3, topClientId: 'a', topClientMonthly: 3000, totalActiveMonthly: 10000 },
          ap: { ratio: 0.5, passiveMonthly: 5000, activeMonthly: 5000, totalMonthly: 10000 },
          ti: { ratio: 1, passiveMonthly: 5000, mandatoryMonthly: 5000 },
        }),
      },
      propertyLeverage: [],
    });
    expect(signals).toEqual([]);
  });
});
