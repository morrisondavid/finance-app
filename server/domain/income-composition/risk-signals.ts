/**
 * Risk signals — typed discriminated union surfaced for §1.8 to consume
 * directly without re-derivation (§1.7).
 *
 * Each variant inlines its own primitive fields next to `code` and
 * `severity` (same convention as `IncomingObligationSchema` in
 * `shared/api-contracts.ts`). No `detail` or `recommended_action`
 * strings — consumers compose any prose they need from the data.
 *
 * Threshold bands live as constants below. They're easy to tune once
 * lived experience tells us the right values.
 */

import type { CurrencyCode } from '../../../shared/api-contracts.js';
import type { IncomeCompositionMetrics } from './metrics.js';

export type RiskSeverity = 'high' | 'medium';

export const CLIENT_CONCENTRATION_EXTREME = 0.8;
export const CLIENT_CONCENTRATION_ELEVATED = 0.5;

export const TIME_INDEPENDENCE_LOW = 0.25;
export const TIME_INDEPENDENCE_ELEVATED = 0.5;
/** Default target the `additionalPassiveNeeded` field is computed against. */
export const TIME_INDEPENDENCE_TARGET = 0.5;

export const MODE_CONCENTRATION_EXTREME = 0.9;

export const LEVERAGED_PASSIVE_HIGH = 0.3;
export const LEVERAGED_PASSIVE_MEDIUM = 0.5;

export type RiskSignal =
  | {
      readonly code: 'client-concentration-extreme' | 'client-concentration-elevated';
      readonly severity: RiskSeverity;
      readonly currency: CurrencyCode;
      readonly ratio: number;
      readonly topClientId: string;
      readonly topClientMonthly: number;
      readonly totalActiveMonthly: number;
      readonly threshold: number;
    }
  | {
      readonly code: 'time-independence-low' | 'time-independence-elevated';
      readonly severity: RiskSeverity;
      readonly currency: CurrencyCode;
      readonly ratio: number;
      readonly passiveMonthly: number;
      readonly mandatoryMonthly: number;
      readonly targetRatio: number;
      readonly additionalPassiveNeeded: number;
      readonly mandatoryReductionNeeded: number;
    }
  | {
      readonly code: 'mode-concentration-extreme';
      readonly severity: 'high';
      readonly currency: CurrencyCode;
      readonly activeShare: number;
      readonly passiveShare: number;
      readonly totalMonthly: number;
      readonly threshold: number;
    }
  | {
      readonly code: 'passive-income-zero';
      readonly severity: 'high';
      readonly currency: CurrencyCode;
      readonly passiveMonthly: 0;
      readonly mandatoryMonthly: number;
    }
  | {
      readonly code: 'leveraged-passive-income';
      readonly severity: RiskSeverity;
      readonly propertyId: string;
      readonly grossMonthly: number;
      readonly mortgageMonthly: number;
      readonly netMonthly: number;
      readonly netToGrossRatio: number;
      readonly threshold: number;
    };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Per-property mortgage-cash figure, supplied by the caller. Built from
 * `debts.csv` mortgage rows (matched by `merchant_pattern`) and recent
 * matched payments — the existing debts repository already exposes this
 * for the debts UI; the runway endpoint reused the same logic.
 */
export interface PropertyLeverageInput {
  readonly propertyId: string;
  readonly grossMonthly: number;
  readonly mortgageMonthly: number;
}

export interface ComputeRiskSignalsInput {
  /**
   * Per-currency household metrics — the household block from
   * `computeIncomeComposition`. Each currency emits its own signals so
   * GBP and AED never blend.
   */
  readonly householdMetrics: Partial<Record<CurrencyCode, IncomeCompositionMetrics>>;
  /**
   * Per-property leverage inputs. The aggregator/caller builds these by
   * joining rental-income obligations with mortgage-cash for the same
   * `property_id`. Empty when no rentals (or no mortgage data) exist.
   */
  readonly propertyLeverage: readonly PropertyLeverageInput[];
}

function computeCurrencySignals(
  currency: CurrencyCode,
  m: IncomeCompositionMetrics,
): RiskSignal[] {
  const out: RiskSignal[] = [];

  // Client concentration
  const cc = m.clientConcentration;
  if (cc.totalActiveMonthly > 0 && cc.topClientId !== null) {
    if (cc.ratio >= CLIENT_CONCENTRATION_EXTREME) {
      out.push({
        code: 'client-concentration-extreme',
        severity: 'high',
        currency,
        ratio: cc.ratio,
        topClientId: cc.topClientId,
        topClientMonthly: cc.topClientMonthly,
        totalActiveMonthly: cc.totalActiveMonthly,
        threshold: CLIENT_CONCENTRATION_EXTREME,
      });
    } else if (cc.ratio >= CLIENT_CONCENTRATION_ELEVATED) {
      out.push({
        code: 'client-concentration-elevated',
        severity: 'medium',
        currency,
        ratio: cc.ratio,
        topClientId: cc.topClientId,
        topClientMonthly: cc.topClientMonthly,
        totalActiveMonthly: cc.totalActiveMonthly,
        threshold: CLIENT_CONCENTRATION_ELEVATED,
      });
    }
  }

  // Time-independence
  const ti = m.timeIndependence;
  if (ti.mandatoryMonthly > 0) {
    const target = TIME_INDEPENDENCE_TARGET;
    const additionalPassiveNeeded = round2(Math.max(0, target * ti.mandatoryMonthly - ti.passiveMonthly));
    const mandatoryReductionNeeded = round2(
      Math.max(0, ti.mandatoryMonthly - (target > 0 ? ti.passiveMonthly / target : ti.mandatoryMonthly)),
    );
    if (ti.ratio < TIME_INDEPENDENCE_LOW) {
      out.push({
        code: 'time-independence-low',
        severity: 'high',
        currency,
        ratio: ti.ratio,
        passiveMonthly: ti.passiveMonthly,
        mandatoryMonthly: ti.mandatoryMonthly,
        targetRatio: target,
        additionalPassiveNeeded,
        mandatoryReductionNeeded,
      });
    } else if (ti.ratio < TIME_INDEPENDENCE_ELEVATED) {
      out.push({
        code: 'time-independence-elevated',
        severity: 'medium',
        currency,
        ratio: ti.ratio,
        passiveMonthly: ti.passiveMonthly,
        mandatoryMonthly: ti.mandatoryMonthly,
        targetRatio: target,
        additionalPassiveNeeded,
        mandatoryReductionNeeded,
      });
    }
  }

  // Mode concentration (active share of total)
  const ap = m.activePassiveRatio;
  if (ap.totalMonthly > 0) {
    const activeShare = ap.activeMonthly === 0 ? 0 : ap.activeMonthly / ap.totalMonthly;
    if (activeShare >= MODE_CONCENTRATION_EXTREME) {
      out.push({
        code: 'mode-concentration-extreme',
        severity: 'high',
        currency,
        activeShare: round2(activeShare),
        passiveShare: round2(1 - activeShare),
        totalMonthly: ap.totalMonthly,
        threshold: MODE_CONCENTRATION_EXTREME,
      });
    }
  }

  // Passive income zero (only when there's any income at all + bills exist)
  if (ap.passiveMonthly === 0 && ap.totalMonthly > 0 && ti.mandatoryMonthly > 0) {
    out.push({
      code: 'passive-income-zero',
      severity: 'high',
      currency,
      passiveMonthly: 0,
      mandatoryMonthly: ti.mandatoryMonthly,
    });
  }

  return out;
}

export function computeRiskSignals(input: ComputeRiskSignalsInput): RiskSignal[] {
  const out: RiskSignal[] = [];

  for (const [currency, metrics] of Object.entries(input.householdMetrics) as [CurrencyCode, IncomeCompositionMetrics][]) {
    if (metrics === undefined) continue;
    out.push(...computeCurrencySignals(currency, metrics));
  }

  // Per-property leveraged-passive-income signals.
  for (const lev of input.propertyLeverage) {
    if (lev.grossMonthly <= 0) continue;
    const net = round2(lev.grossMonthly - lev.mortgageMonthly);
    const ratio = round2(net / lev.grossMonthly);
    if (ratio < LEVERAGED_PASSIVE_HIGH) {
      out.push({
        code: 'leveraged-passive-income',
        severity: 'high',
        propertyId: lev.propertyId,
        grossMonthly: round2(lev.grossMonthly),
        mortgageMonthly: round2(lev.mortgageMonthly),
        netMonthly: net,
        netToGrossRatio: ratio,
        threshold: LEVERAGED_PASSIVE_HIGH,
      });
    } else if (ratio < LEVERAGED_PASSIVE_MEDIUM) {
      out.push({
        code: 'leveraged-passive-income',
        severity: 'medium',
        propertyId: lev.propertyId,
        grossMonthly: round2(lev.grossMonthly),
        mortgageMonthly: round2(lev.mortgageMonthly),
        netMonthly: net,
        netToGrossRatio: ratio,
        threshold: LEVERAGED_PASSIVE_MEDIUM,
      });
    }
  }

  return out;
}
