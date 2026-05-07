/**
 * JSON shape for §1.9 debt-strategy read bundle — shared by
 * `GET /api/debt-strategy/state` and `GET /api/ai/debt-strategy`.
 */

import type { AssembledDebtStrategy } from './assemble.js';
import type { LoadedForecastInputs } from '../forecast/load-inputs.js';

/** Recursively materialise Maps/Sets so `JSON.stringify` matches in-process payloads. */
function toJsonSafe(value: unknown): unknown {
  if (value instanceof Map) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of value) {
      o[String(k)] = toJsonSafe(v);
    }
    return o;
  }
  if (value instanceof Set) {
    return [...value].map(toJsonSafe);
  }
  if (Array.isArray(value)) {
    return value.map(toJsonSafe);
  }
  if (value !== null && typeof value === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      o[k] = toJsonSafe(v);
    }
    return o;
  }
  return value;
}

function forecastInputsToJson(inputs: LoadedForecastInputs): Record<string, unknown> {
  return toJsonSafe(inputs) as Record<string, unknown>;
}

export function debtStrategyBundleToResponseJson(
  bundle: AssembledDebtStrategy,
): Record<string, unknown> {
  return {
    today: bundle.today,
    headroomByBucket: Array.from(bundle.headroomByBucket.entries()).map(([key, b]) => ({
      key,
      currency: b.currency,
      scope: b.scope,
      totalHeadroom: b.totalHeadroom,
      availableHeadroom: b.availableHeadroom,
      intensityOptions: b.intensityOptions,
    })),
    activePlans: bundle.activePlans,
    pausedPlans: bundle.pausedPlans,
    completedPlans: bundle.completedPlans,
    suggestedPlans: bundle.suggestedPlans,
    movements: bundle.movements,
    feasibilityReports: Array.from(bundle.feasibilityReports.entries()).map(([id, r]) => ({
      planId: id,
      ...r,
    })),
    refinanceComparisons: Array.from(bundle.refinanceComparisons.entries()).map(([id, r]) => ({
      debtId: id,
      ...r,
    })),
    targetReachedReports: Array.from(bundle.targetReachedReports.entries()).map(([id, r]) => ({
      planId: id,
      ...r,
    })),
    strategyCapital: bundle.strategyCapital,
    refinanceRecommendations: Array.from(bundle.refinanceRecommendations.entries()).map(
      ([debtId, r]) => ({
        debtId,
        kind: r.kind,
        total_cost_savings_vs_keep: r.total_cost_savings_vs_keep,
      }),
    ),
    creditCardPaydownHints: bundle.creditCardPaydownHints,
    crossScopeTransferPreview: bundle.crossScopeTransferPreview,
    debtStrategyContext: {
      today: bundle.debtStrategyContext.today,
      strategyCapital: bundle.debtStrategyContext.strategyCapital,
      forecastInputs:
        bundle.debtStrategyContext.forecastInputs === undefined
          ? undefined
          : forecastInputsToJson(bundle.debtStrategyContext.forecastInputs),
      strategyPeriodApproxMonths: bundle.debtStrategyContext.strategyPeriodApproxMonths,
      debtsById: Object.fromEntries(bundle.debtStrategyContext.debtsById),
      availableHeadroomByBucket: Object.fromEntries(
        bundle.debtStrategyContext.availableHeadroomByBucket,
      ),
      holisticMoneyForDebtGbp: bundle.debtStrategyContext.holisticMoneyForDebtGbp,
      holisticMoneyForDebtAed: bundle.debtStrategyContext.holisticMoneyForDebtAed,
    },
    sandboxIncomeSources: bundle.sandboxIncomeSources,
  };
}
