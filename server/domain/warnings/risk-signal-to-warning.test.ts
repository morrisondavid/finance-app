import { describe, it, expect } from 'vitest';
import { formatRiskSignalAsWarning } from './risk-signal-to-warning.js';
import type { RiskSignal } from '../income-composition/risk-signals.js';
import { EntityFoundationWarningSchema } from '../../../shared/api-contracts.js';

describe('formatRiskSignalAsWarning', () => {
  it('every variant produces a Warning that round-trips through the Zod schema', () => {
    const fixtures: RiskSignal[] = [
      {
        code: 'client-concentration-extreme',
        severity: 'high',
        currency: 'GBP',
        ratio: 1.0,
        topClientId: 'delta-capita',
        topClientMonthly: 10000,
        totalActiveMonthly: 10000,
        threshold: 0.8,
      },
      {
        code: 'client-concentration-elevated',
        severity: 'medium',
        currency: 'AED',
        ratio: 0.6,
        topClientId: 'mce-advisory',
        topClientMonthly: 6000,
        totalActiveMonthly: 10000,
        threshold: 0.5,
      },
      {
        code: 'time-independence-low',
        severity: 'high',
        currency: 'GBP',
        ratio: 0.07,
        passiveMonthly: 700,
        mandatoryMonthly: 10000,
        targetRatio: 0.5,
        additionalPassiveNeeded: 4300,
        mandatoryReductionNeeded: 8600,
      },
      {
        code: 'time-independence-elevated',
        severity: 'medium',
        currency: 'GBP',
        ratio: 0.3,
        passiveMonthly: 3000,
        mandatoryMonthly: 10000,
        targetRatio: 0.5,
        additionalPassiveNeeded: 2000,
        mandatoryReductionNeeded: 4000,
      },
      {
        code: 'mode-concentration-extreme',
        severity: 'high',
        currency: 'GBP',
        activeShare: 0.95,
        passiveShare: 0.05,
        totalMonthly: 12000,
        threshold: 0.9,
      },
      {
        code: 'passive-income-zero',
        severity: 'high',
        currency: 'GBP',
        passiveMonthly: 0,
        mandatoryMonthly: 5000,
      },
      {
        code: 'leveraged-passive-income',
        severity: 'high',
        propertyId: 'hunters-square-78',
        grossMonthly: 1000,
        mortgageMonthly: 800,
        netMonthly: 200,
        netToGrossRatio: 0.2,
        threshold: 0.3,
      },
    ];

    for (const fx of fixtures) {
      const w = formatRiskSignalAsWarning(fx);
      // Round-trips through the schema
      expect(() => EntityFoundationWarningSchema.parse(w)).not.toThrow();
      // Strings are non-empty
      expect(w.title.length).toBeGreaterThan(0);
      expect(w.detail.length).toBeGreaterThan(0);
      expect(w.recommended_action.length).toBeGreaterThan(0);
      // Context preserves at least one primitive
      expect(w.context).toBeDefined();
    }
  });

  it('client-concentration ID is stable per (currency, topClientId)', () => {
    const a = formatRiskSignalAsWarning({
      code: 'client-concentration-extreme',
      severity: 'high',
      currency: 'GBP',
      ratio: 1,
      topClientId: 'delta-capita',
      topClientMonthly: 1,
      totalActiveMonthly: 1,
      threshold: 0.8,
    });
    const b = formatRiskSignalAsWarning({
      code: 'client-concentration-extreme',
      severity: 'high',
      currency: 'GBP',
      ratio: 1,
      topClientId: 'delta-capita',
      topClientMonthly: 999,
      totalActiveMonthly: 999,
      threshold: 0.8,
    });
    expect(a.id).toBe(b.id);
  });

  it('leveraged-passive-income high severity maps to info', () => {
    const w = formatRiskSignalAsWarning({
      code: 'leveraged-passive-income',
      severity: 'high',
      propertyId: 'p',
      grossMonthly: 1000,
      mortgageMonthly: 800,
      netMonthly: 200,
      netToGrossRatio: 0.2,
      threshold: 0.3,
    });
    expect(w.severity).toBe('info');
  });

  it('leveraged-passive-income medium severity maps to info', () => {
    const w = formatRiskSignalAsWarning({
      code: 'leveraged-passive-income',
      severity: 'medium',
      propertyId: 'p',
      grossMonthly: 1000,
      mortgageMonthly: 600,
      netMonthly: 400,
      netToGrossRatio: 0.4,
      threshold: 0.5,
    });
    expect(w.severity).toBe('info');
  });

  it('preserves primitives on context exactly', () => {
    const signal: RiskSignal = {
      code: 'time-independence-low',
      severity: 'high',
      currency: 'GBP',
      ratio: 0.07,
      passiveMonthly: 700,
      mandatoryMonthly: 10000,
      targetRatio: 0.5,
      additionalPassiveNeeded: 4300,
      mandatoryReductionNeeded: 8600,
    };
    const w = formatRiskSignalAsWarning(signal);
    expect(w.context?.ratio).toBe(0.07);
    expect(w.context?.passiveMonthly).toBe(700);
    expect(w.context?.additionalPassiveNeeded).toBe(4300);
    expect(w.context?.mandatoryReductionNeeded).toBe(8600);
  });
});
