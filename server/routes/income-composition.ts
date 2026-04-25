/**
 * GET /api/income-composition — three single-mode-risk metrics + risk
 * signals over the existing income surface (§1.7).
 *
 * Thin route. Composes:
 *   - active contracts (from the contracts registry)
 *   - rental-income obligations + the obligations behind them
 *   - the recurring-pipeline detected income (deduped against contracts/rentals)
 *   - mandatory monthly outgoings per currency (recurring pipeline filtered by
 *     `isMandatoryCategory` from `shared/expenses-insight.ts`)
 *   - per-property mortgage cash for the leveraged-passive-income signals
 *     (joined from `debts.csv` + recurring pipeline)
 *
 * No netting on the income side; symmetric mandatory-outgoings on the
 * other side. See the §1.7 plan for the rationale.
 */

import { Router, type Request, type Response } from 'express';
import {
  type CurrencyCode,
  IncomeCompositionResponseSchema,
} from '../../shared/api-contracts.js';
import { todayIsoLocal } from '../../shared/iso-date.js';
import { isMandatoryCategory } from '../../shared/expenses-insight.js';

import { listActiveContracts } from '../domain/contracts/queries.js';
import { allClients } from '../domain/clients/queries.js';
import { getObligationRegistry } from '../domain/obligations/registry.js';
import { runExpensesOverviewPipeline } from '../utils/expenses-overview-pipeline.js';
import { listDebts } from '../db/repositories/debts.js';

import {
  computeIncomeComposition,
  computeRiskSignals,
  listAllIncomeSources,
  type IncomeSource,
  type PropertyLeverageInput,
} from '../domain/income-composition/index.js';

const router = Router();

function buildClientLabelMap(): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of allClients()) {
    out.set(c.id, c.trading_name ?? c.legal_name);
  }
  return out;
}

/**
 * Sum mandatory recurring outgoings per currency from the pipeline. Uses
 * `nativeCurrency`/`nativeAmount` when present (non-GBP bills), falling back
 * to the GBP `amount` otherwise. Annual items contribute amortised monthly
 * (annual ÷ 12).
 */
function buildMandatoryMonthlyByCurrency(
  pipeline: ReturnType<typeof runExpensesOverviewPipeline>,
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
 * For each rental-income obligation with a `propertyId`, find the matching
 * mortgage's monthly cash payment (from the recurring pipeline) and emit a
 * leverage input. Properties with no rental obligation OR no matching
 * mortgage are skipped — the signal only fires when both sides exist.
 */
function buildPropertyLeverageInputs(
  pipeline: ReturnType<typeof runExpensesOverviewPipeline>,
): PropertyLeverageInput[] {
  const obligations = getObligationRegistry();
  const rentals = obligations.listByCategory('rental-income');
  const debts = listDebts();

  // Map property_id → gross monthly rent (sum across rentals on that property).
  const grossByProperty = new Map<string, number>();
  for (const r of rentals) {
    if (r.propertyId === undefined || r.propertyId === '') continue;
    grossByProperty.set(r.propertyId, (grossByProperty.get(r.propertyId) ?? 0) + r.amount);
  }

  // For each mortgage, find its recurring-pipeline monthly cash payment.
  // Match by merchant_pattern (substring, case-insensitive).
  function mortgageMonthlyCash(merchantPattern: string): number {
    const needle = merchantPattern.toLowerCase();
    let total = 0;
    for (const e of pipeline.monthlyExpenseRecurring) {
      if (e.merchant.toLowerCase().includes(needle)) {
        total += e.amount; // GBP-normalised; mortgages here are all GBP
      }
    }
    return total;
  }

  const out: PropertyLeverageInput[] = [];
  for (const debt of debts) {
    if (debt.kind !== 'mortgage') continue;
    if (debt.propertyId === null || debt.propertyId === '') continue;
    const gross = grossByProperty.get(debt.propertyId);
    if (gross === undefined || gross <= 0) continue; // not a rental
    const mortgage = mortgageMonthlyCash(debt.merchantPattern);
    if (mortgage <= 0) continue; // can't compute leverage without mortgage cash
    out.push({
      propertyId: debt.propertyId,
      grossMonthly: gross,
      mortgageMonthly: mortgage,
    });
  }
  return out;
}

router.get('/', (_req: Request, res: Response) => {
  try {
    const today = todayIsoLocal();
    const pipeline = runExpensesOverviewPipeline();
    const obligations = getObligationRegistry();

    const sources: IncomeSource[] = listAllIncomeSources({
      contracts: listActiveContracts(),
      obligations: obligations.all,
      monthlyIncomeRecurring: pipeline.monthlyIncomeRecurring,
      clientLabelById: buildClientLabelMap(),
    });

    const mandatoryMonthlyByCurrency = buildMandatoryMonthlyByCurrency(pipeline);
    const composition = computeIncomeComposition({
      sources,
      mandatoryMonthlyByCurrency,
    });

    const propertyLeverage = buildPropertyLeverageInputs(pipeline);
    const riskSignals = computeRiskSignals({
      householdMetrics: composition.household,
      propertyLeverage,
    });

    const body = IncomeCompositionResponseSchema.parse({
      today,
      household: composition.household,
      byEntity: composition.byEntity,
      sources,
      riskSignals,
    });
    res.json(body);
  } catch (error) {
    console.error('[IncomeComposition] GET / error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build income composition: ${message}` });
  }
});

export default router;
