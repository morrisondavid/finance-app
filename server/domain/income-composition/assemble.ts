/**
 * I/O orchestration for §1.7's income composition. Loads from contracts /
 * obligations / debts / expenses pipeline registries and feeds the pure
 * `aggregator` + `metrics` + `risk-signals` modules.
 *
 * Two consumers:
 *   - [`server/routes/income-composition.ts`](../../routes/income-composition.ts) — returns the full response.
 *   - [`server/domain/warnings/risk-signal-to-warning.ts`](../warnings/risk-signal-to-warning.ts) — bridges the risk signals onto the §1.8 warnings spine.
 *
 * Keeps both consumers off duplicate loader code while leaving the pure
 * modules (aggregator/metrics/risk-signals) free of I/O.
 */

import type { CurrencyCode } from '../../../shared/api-contracts.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { isMandatoryCategory } from '../../../shared/expenses-insight.js';
import { listCurrentContracts } from '../contracts/queries.js';
import { allClients } from '../clients/queries.js';
import { obligationActiveForProjection } from '../obligations/obligation-active.js';
import { getObligationRegistry } from '../obligations/registry.js';
import { runExpensesOverviewPipeline } from '../../utils/expenses-overview-pipeline.js';
import type { PipelineResult } from '../../utils/recurring-pipeline.js';
import { listDebts, type Debt } from '../../db/repositories/debts.js';
import { listAllIncomeSources, type IncomeSource } from './aggregator.js';
import {
  computeIncomeComposition,
  type IncomeCompositionResult,
} from './metrics.js';
import {
  computeRiskSignals,
  type PropertyLeverageInput,
  type RiskSignal,
} from './risk-signals.js';

export interface AssembledIncomeComposition {
  readonly sources: readonly IncomeSource[];
  readonly composition: IncomeCompositionResult;
  readonly riskSignals: readonly RiskSignal[];
  readonly propertyLeverage: readonly PropertyLeverageInput[];
  readonly mandatoryMonthlyByCurrency: ReadonlyMap<CurrencyCode, number>;
}

function buildClientLabelMap(): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of allClients()) {
    out.set(c.id, c.trading_name ?? c.legal_name);
  }
  return out;
}

/**
 * Sum mandatory recurring outgoings per currency from the pipeline. Uses
 * `nativeCurrency`/`nativeAmount` when present (non-GBP bills), falling
 * back to the GBP `amount` otherwise. Annual items contribute amortised
 * monthly (annual ÷ 12).
 */
function buildMandatoryMonthlyByCurrency(
  pipeline: PipelineResult,
): Map<CurrencyCode, number> {
  const out = new Map<CurrencyCode, number>();
  function add(currency: CurrencyCode, amount: number): void {
    out.set(currency, (out.get(currency) ?? 0) + amount);
  }
  for (const e of pipeline.monthlyExpenseRecurring) {
    if (!isMandatoryCategory(e.category)) continue;
    const cur = (e.nativeCurrency as CurrencyCode | undefined) ?? 'GBP';
    const amt = e.nativeAmount ?? e.amount;
    add(cur, amt);
  }
  for (const e of pipeline.annualExpenseRecurring) {
    if (!isMandatoryCategory(e.category)) continue;
    const cur = (e.nativeCurrency as CurrencyCode | undefined) ?? 'GBP';
    const amt = (e.nativeAmount ?? e.amount) / 12;
    add(cur, amt);
  }
  return out;
}

/**
 * For each rental-income obligation with a `propertyId`, look up the
 * matching mortgage's contractual monthly payment and emit a leverage
 * input.
 *
 * The mortgage's monthly cost is read directly from
 * `debt.matchAmounts[0]` per the §1.7/§1.8 convention (index 0 is the
 * current contractual monthly payment). We deliberately do NOT sum the
 * recurring pipeline here — multiple mortgages share the same merchant
 * pattern (e.g. both NatWest mortgages match `merchant LIKE '%natwest%'`)
 * so summing blends them.
 *
 * The active-row gate in the debts CSV reader guarantees every active
 * mortgage has a positive `matchAmounts[0]`, so a mortgage with a
 * matching rental will always contribute a leverage signal — no silent
 * skips for a configured property.
 *
 * Properties with no rental obligation OR no mortgage are still
 * skipped: leverage only makes sense when both sides exist.
 */
export interface BuildPropertyLeverageInputsInput {
  readonly rentals: readonly { readonly propertyId: string | undefined; readonly amount: number }[];
  readonly debts: readonly Pick<
    Debt,
    'kind' | 'propertyId' | 'matchAmounts' | 'archived'
  >[];
}

export function buildPropertyLeverageInputs(
  input: BuildPropertyLeverageInputsInput,
): PropertyLeverageInput[] {
  const grossByProperty = new Map<string, number>();
  for (const r of input.rentals) {
    if (r.propertyId === undefined || r.propertyId === '') continue;
    grossByProperty.set(r.propertyId, (grossByProperty.get(r.propertyId) ?? 0) + r.amount);
  }

  const out: PropertyLeverageInput[] = [];
  for (const debt of input.debts) {
    if (debt.kind !== 'mortgage') continue;
    if (debt.archived) continue;
    if (debt.propertyId === null || debt.propertyId === '') continue;
    const gross = grossByProperty.get(debt.propertyId);
    if (gross === undefined || gross <= 0) continue;
    const monthly = debt.matchAmounts[0];
    if (monthly === undefined || monthly <= 0) continue;
    out.push({
      propertyId: debt.propertyId,
      grossMonthly: gross,
      mortgageMonthly: monthly,
    });
  }
  return out;
}

/**
 * Single entry point that loads all upstream data and produces the full
 * income-composition output. Both `/api/income-composition` and the §1.8
 * warnings risk-signal bridge call this; nothing duplicates the loaders.
 */
export function assembleIncomeComposition(): AssembledIncomeComposition {
  const today = todayIsoLocal();
  const pipeline = runExpensesOverviewPipeline();
  const obligations = getObligationRegistry();

  const sources = listAllIncomeSources({
    today,
    contracts: listCurrentContracts(today),
    obligations: obligations.all,
    monthlyIncomeRecurring: pipeline.monthlyIncomeRecurring,
    clientLabelById: buildClientLabelMap(),
  });

  const mandatoryMonthlyByCurrency = buildMandatoryMonthlyByCurrency(pipeline);
  const composition = computeIncomeComposition({
    sources,
    mandatoryMonthlyByCurrency,
  });

  const propertyLeverage = buildPropertyLeverageInputs({
    rentals: obligations
      .listByCategory('rental-income')
      .filter(obligationActiveForProjection)
      .map(r => ({
        propertyId: r.propertyId,
        amount: r.amount,
      })),
    debts: listDebts(),
  });
  const riskSignals = computeRiskSignals({
    householdMetrics: composition.household,
    propertyLeverage,
  });

  return {
    sources,
    composition,
    riskSignals,
    propertyLeverage,
    mandatoryMonthlyByCurrency,
  };
}
