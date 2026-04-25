/**
 * Income composition metrics — three single-mode-risk numbers (§1.7).
 *
 * - `clientConcentration` answers *"if my biggest client drops me, how
 *   much active income do I lose?"*. Structural — input to the
 *   `client-concentration-*` risk signals.
 * - `activePassiveRatio` answers *"how much of my gross income comes
 *   from sources that don't require active work?"*. Structural mix
 *   metric, NOT a resilience metric. The ratio's primitives travel
 *   with it so consumers can compose any caveat they want.
 * - `timeIndependenceRatio` answers *"if my active income stops, what
 *   fraction of my real bills can passive income cover?"*. The
 *   resilience metric. Symmetric: rental income is gross on the
 *   numerator side, the mortgage is in `mandatory_monthly_outgoings`
 *   on the denominator side, no double-count.
 *
 * Pure: callers supply already-loaded data; no I/O.
 */

import type { CurrencyCode, EntityId } from '../../../shared/api-contracts.js';
import type { IncomeSource } from './aggregator.js';
import type { IncomeKind } from './activity-class.js';

const ROUND_TO = 4; // 4-dp ratios; primitives are 2-dp money below.

function round(n: number, places: number): number {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}
function round2(n: number): number {
  return round(n, 2);
}
function roundRatio(n: number): number {
  return round(n, ROUND_TO);
}

export interface ClientConcentration {
  /** topClientMonthly / totalActiveMonthly. NaN-safe (returns 0 when total === 0). */
  readonly ratio: number;
  readonly topClientId: string | null;
  readonly topClientMonthly: number;
  readonly totalActiveMonthly: number;
}

export interface ActivePassiveRatio {
  /** passiveMonthly / totalMonthly. NaN-safe. */
  readonly ratio: number;
  readonly passiveMonthly: number;
  readonly activeMonthly: number;
  readonly totalMonthly: number;
  /** Passive monthly amount split by source kind (passive kinds only). */
  readonly passiveByKind: Readonly<Record<IncomeKind, number>>;
}

export interface TimeIndependence {
  /** passiveMonthly / mandatoryMonthly. NaN-safe. */
  readonly ratio: number;
  readonly passiveMonthly: number;
  readonly mandatoryMonthly: number;
}

export interface IncomeCompositionMetrics {
  readonly clientConcentration: ClientConcentration;
  readonly activePassiveRatio: ActivePassiveRatio;
  readonly timeIndependence: TimeIndependence;
}

/** A single (entityId | null) × currency rollup. */
export interface IncomeCompositionScope {
  readonly entityId: EntityId | null;
  readonly currency: CurrencyCode;
  readonly metrics: IncomeCompositionMetrics;
}

export interface IncomeCompositionResult {
  /** Household level — keyed by currency only (entityId is null/blended-by-merging). */
  readonly household: Partial<Record<CurrencyCode, IncomeCompositionMetrics>>;
  /** Per-(entityId, currency) drill-down. Empty when no entity-tagged sources exist. */
  readonly byEntity: readonly IncomeCompositionScope[];
}

export interface ComputeIncomeCompositionInput {
  readonly sources: readonly IncomeSource[];
  /**
   * Σ(items where isMandatoryCategory(item.category)) per currency. Sourced
   * by the caller from the recurring pipeline so this module stays I/O-free.
   * Currencies absent from this map are treated as 0.
   */
  readonly mandatoryMonthlyByCurrency: ReadonlyMap<CurrencyCode, number>;
}

function safeRatio(num: number, den: number): number {
  if (den === 0) return 0;
  return roundRatio(num / den);
}

/** Compute client-concentration over a scoped slice of sources. */
function computeClientConcentration(scoped: readonly IncomeSource[]): ClientConcentration {
  const activeByClient = new Map<string, number>();
  let totalActive = 0;
  for (const s of scoped) {
    if (s.activityClass !== 'active') continue;
    if (s.clientId === null) continue;
    const prev = activeByClient.get(s.clientId) ?? 0;
    activeByClient.set(s.clientId, prev + s.monthlyAmount);
    totalActive += s.monthlyAmount;
  }
  let topClientId: string | null = null;
  let topClientMonthly = 0;
  for (const [clientId, monthly] of activeByClient) {
    if (monthly > topClientMonthly) {
      topClientId = clientId;
      topClientMonthly = monthly;
    }
  }
  return {
    ratio: safeRatio(topClientMonthly, totalActive),
    topClientId,
    topClientMonthly: round2(topClientMonthly),
    totalActiveMonthly: round2(totalActive),
  };
}

/** Compute active/passive ratio over a scoped slice of sources. */
function computeActivePassiveRatio(scoped: readonly IncomeSource[]): ActivePassiveRatio {
  const passiveByKind: Record<IncomeKind, number> = {
    contract: 0,
    'rental-income': 0,
    'recurring-detected': 0,
  };
  let activeMonthly = 0;
  let passiveMonthly = 0;
  for (const s of scoped) {
    if (s.activityClass === 'active') {
      activeMonthly += s.monthlyAmount;
    } else {
      passiveMonthly += s.monthlyAmount;
      passiveByKind[s.kind] += s.monthlyAmount;
    }
  }
  const total = activeMonthly + passiveMonthly;
  return {
    ratio: safeRatio(passiveMonthly, total),
    passiveMonthly: round2(passiveMonthly),
    activeMonthly: round2(activeMonthly),
    totalMonthly: round2(total),
    passiveByKind: {
      contract: round2(passiveByKind.contract),
      'rental-income': round2(passiveByKind['rental-income']),
      'recurring-detected': round2(passiveByKind['recurring-detected']),
    },
  };
}

/** Compute time-independence over a scoped slice + a mandatory-outgoings figure. */
function computeTimeIndependence(
  scoped: readonly IncomeSource[],
  mandatoryMonthly: number,
): TimeIndependence {
  let passiveMonthly = 0;
  for (const s of scoped) {
    if (s.activityClass !== 'active') passiveMonthly += s.monthlyAmount;
  }
  return {
    ratio: safeRatio(passiveMonthly, mandatoryMonthly),
    passiveMonthly: round2(passiveMonthly),
    mandatoryMonthly: round2(mandatoryMonthly),
  };
}

function computeMetrics(
  scoped: readonly IncomeSource[],
  mandatoryMonthly: number,
): IncomeCompositionMetrics {
  return {
    clientConcentration: computeClientConcentration(scoped),
    activePassiveRatio: computeActivePassiveRatio(scoped),
    timeIndependence: computeTimeIndependence(scoped, mandatoryMonthly),
  };
}

export function computeIncomeComposition(
  input: ComputeIncomeCompositionInput,
): IncomeCompositionResult {
  const { sources, mandatoryMonthlyByCurrency } = input;

  // Bucket by currency (household) and by (entityId, currency) (drill-down).
  const byCurrency = new Map<CurrencyCode, IncomeSource[]>();
  const byEntityCurrency = new Map<string, { entityId: EntityId | null; currency: CurrencyCode; sources: IncomeSource[] }>();
  for (const s of sources) {
    const list = byCurrency.get(s.currency) ?? [];
    list.push(s);
    byCurrency.set(s.currency, list);

    const key = `${s.entityId ?? '__null'}::${s.currency}`;
    const ent = byEntityCurrency.get(key);
    if (ent) {
      ent.sources.push(s);
    } else {
      byEntityCurrency.set(key, {
        entityId: s.entityId,
        currency: s.currency,
        sources: [s],
      });
    }
  }

  const household: Partial<Record<CurrencyCode, IncomeCompositionMetrics>> = {};
  for (const [currency, scoped] of byCurrency) {
    const mandatory = mandatoryMonthlyByCurrency.get(currency) ?? 0;
    household[currency] = computeMetrics(scoped, mandatory);
  }

  const byEntity: IncomeCompositionScope[] = [];
  for (const { entityId, currency, sources: scoped } of byEntityCurrency.values()) {
    // Per-entity slice still uses the full mandatory-outgoings figure for
    // the currency — bills don't disappear because an entity does. Same
    // resilience question, scoped to the income side only.
    const mandatory = mandatoryMonthlyByCurrency.get(currency) ?? 0;
    byEntity.push({
      entityId,
      currency,
      metrics: computeMetrics(scoped, mandatory),
    });
  }

  return { household, byEntity };
}
