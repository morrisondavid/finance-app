/**
 * I/O orchestration for §1.9's Debt Strategy planner.
 *
 * Single entrypoint shared by:
 *   - `server/routes/debt-strategy.ts` (the API)
 *   - `server/domain/warnings/plan-*.ts` (the §1.8 spine emitters)
 *
 * Loads from registries (debts, plans, movements, budgets, accounts)
 * and the recurring-expenses pipeline; runs the pure planner modules;
 * returns one bundle. Nothing in the bundle is cached — every call
 * recomputes against the latest data per §1.9's "no silent recompute"
 * contract (we want recompute on user-initiated reads, not background
 * data changes; the route IS user-initiated).
 *
 * DRY:
 *   - Reuses `runExpensesOverviewPipeline` to derive forecasted
 *     monthly income + mandatory bills.
 *   - Reuses `getAllDebtSummaries` for currentBalance per debt (the
 *     auto-completion gate).
 *   - Reuses `listBudgets` from the existing budgets repository for
 *     the inviolable category caps.
 *   - Reuses `assembleRunway` for the what-if sandbox (called
 *     separately by the sandbox endpoint).
 */

import {
  type AccountName,
  type CurrencyCode,
} from '../../../shared/api-contracts.js';
import { isMandatoryCategory } from '../../../shared/expenses-insight.js';
import { runExpensesOverviewPipeline } from '../../utils/expenses-overview-pipeline.js';
import { getAllDebtSummaries, type DebtSummary } from '../../db/repositories/debts.js';
import { listBudgets } from '../../db/repositories/budgets.js';
import { ACCOUNT_CONFIG_DATA } from '../accounts/data.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';

import type { Plan, PlanScope, SuggestedPlan } from './schema.js';
import type { Movement } from './movements-schema.js';
import { getPlanRegistry } from './registry.js';
import { getMovementRegistry } from './movements-registry.js';
import { computeHeadroom } from './compute-headroom.js';
import { availableHeadroom } from './available-headroom.js';
import {
  presentIntensityOptions,
  type IntensityOptionsResult,
} from './present-intensity-options.js';
import {
  checkPlanFeasibility,
  type FeasibilityReport,
} from './check-plan-feasibility.js';
import {
  evaluateRefinanceTradeoffWithToday,
  type EvaluateRefinanceTradeoffResult,
} from './evaluate-refinance-tradeoff.js';
import {
  detectTargetReached,
  type DetectTargetReachedResult,
} from './detect-target-reached.js';
import {
  autoSuggestPlans,
  bucketKey,
  type AutoSuggestDebt,
} from './auto-suggest-plans.js';

export interface BucketHeadroom {
  readonly currency: CurrencyCode;
  readonly scope: PlanScope;
  readonly totalHeadroom: number;
  readonly availableHeadroom: number;
  /** Intensity options computed against the currently-available headroom. */
  readonly intensityOptions: IntensityOptionsResult;
}

export interface AssembledDebtStrategy {
  readonly today: string;
  readonly headroomByBucket: ReadonlyMap<string, BucketHeadroom>;
  readonly activePlans: readonly Plan[];
  readonly pausedPlans: readonly Plan[];
  readonly completedPlans: readonly Plan[];
  readonly suggestedPlans: readonly SuggestedPlan[];
  readonly movements: readonly Movement[];
  readonly feasibilityReports: ReadonlyMap<string, FeasibilityReport>;
  /** Per debt id (only for pay-off-debt plans where target debt + a configured creditCard exist). */
  readonly refinanceComparisons: ReadonlyMap<string, EvaluateRefinanceTradeoffResult>;
  /** Per active plan id. */
  readonly targetReachedReports: ReadonlyMap<string, DetectTargetReachedResult>;
}

/**
 * Optional inputs the route can supply for the what-if sandbox to
 * tweak the inputs (e.g. simulate a removed contract).
 */
export interface AssembleDebtStrategyInput {
  readonly today?: string;
  /**
   * Override the forecasted monthly income per (currency, scope)
   * bucket. Used by the sandbox endpoint to model "what if I lost
   * this contract?". Live mode passes nothing.
   */
  readonly incomeOverrides?: ReadonlyMap<string, number>;
}

function scopeForAccount(account: AccountName): PlanScope {
  const cfg = ACCOUNT_CONFIG_DATA[account];
  if (cfg.category === 'business') return cfg.entityId;
  return 'household';
}

/**
 * Sum recurring monthly inflow per (currency, scope) bucket. Income is
 * routed by which account it landed on. Returns a Map keyed by
 * `bucketKey(currency, scope)`.
 */
function buildIncomeByBucket(
  pipeline: ReturnType<typeof runExpensesOverviewPipeline>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of pipeline.monthlyIncomeRecurring) {
    const accountStr = item.sourceAccount;
    if (!isAccountName(accountStr)) continue;
    const cfg = ACCOUNT_CONFIG_DATA[accountStr];
    if (cfg === undefined) continue;
    const scope = scopeForAccount(accountStr);
    const key = bucketKey(cfg.currency, scope);
    // Use native amount/currency where available so AED stays AED.
    const native = item.nativeAmount;
    const nativeCurrency = item.nativeCurrency as CurrencyCode | undefined;
    if (native !== undefined && nativeCurrency !== undefined) {
      const nativeKey = bucketKey(nativeCurrency, scope);
      out.set(nativeKey, (out.get(nativeKey) ?? 0) + Math.abs(native));
    } else {
      out.set(key, (out.get(key) ?? 0) + Math.abs(item.amount));
    }
  }
  return out;
}

function buildMandatoryByBucket(
  pipeline: ReturnType<typeof runExpensesOverviewPipeline>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of pipeline.monthlyExpenseRecurring) {
    if (!isMandatoryCategory(item.category)) continue;
    const accountStr = item.sourceAccount;
    if (!isAccountName(accountStr)) continue;
    const cfg = ACCOUNT_CONFIG_DATA[accountStr];
    if (cfg === undefined) continue;
    const scope = scopeForAccount(accountStr);
    const native = item.nativeAmount;
    const nativeCurrency = item.nativeCurrency as CurrencyCode | undefined;
    if (native !== undefined && nativeCurrency !== undefined) {
      const nativeKey = bucketKey(nativeCurrency, scope);
      out.set(nativeKey, (out.get(nativeKey) ?? 0) + Math.abs(native));
    } else {
      const key = bucketKey(cfg.currency, scope);
      out.set(key, (out.get(key) ?? 0) + Math.abs(item.amount));
    }
  }
  return out;
}

function isAccountName(value: string): value is AccountName {
  return value in ACCOUNT_CONFIG_DATA;
}

function buildBudgetsByBucket(): Map<string, number> {
  const out = new Map<string, number>();
  const allBudgets = listBudgets({});
  for (const b of allBudgets) {
    const cfg = ACCOUNT_CONFIG_DATA[b.account];
    if (cfg === undefined) continue;
    const scope = scopeForAccount(b.account);
    const key = bucketKey(cfg.currency, scope);
    // Budgets are monthly amounts (annual budgets are normalised in
    // listBudgets's row.amount when budget_period is 'monthly';
    // if 'yearly', divide by 12 here).
    const monthlyAmt = b.period === 'yearly' ? b.amount / 12 : b.amount;
    out.set(key, (out.get(key) ?? 0) + monthlyAmt);
  }
  return out;
}

function debtToAutoSuggestDebt(s: DebtSummary): AutoSuggestDebt | null {
  // Only consumer + active + has a configured source account (use first if multi).
  const fromAccount = s.sourceAccounts[0] as AccountName | undefined;
  if (fromAccount === undefined) return null;
  const cfg = ACCOUNT_CONFIG_DATA[fromAccount];
  if (cfg === undefined) return null;
  return {
    id: s.id,
    name: s.name,
    apr: (s.interestRate ?? 0) / 100, // interestRate stored as percent (e.g. 4.48); convert to decimal
    kind: s.kind,
    archived: s.archived,
    currentBalance: s.currentBalance,
    fromAccount,
    currency: cfg.currency,
    scope: scopeForAccount(fromAccount),
  };
}

export function assembleDebtStrategy(
  input: AssembleDebtStrategyInput = {},
): AssembledDebtStrategy {
  const today = input.today ?? todayIsoLocal();
  const pipeline = runExpensesOverviewPipeline();

  // 1. Build per-bucket monthly figures.
  const incomeByBucket = buildIncomeByBucket(pipeline);
  if (input.incomeOverrides !== undefined) {
    for (const [k, v] of input.incomeOverrides) {
      incomeByBucket.set(k, v);
    }
  }
  const mandatoryByBucket = buildMandatoryByBucket(pipeline);
  const budgetsByBucket = buildBudgetsByBucket();

  // 2. Compute total + available headroom per bucket.
  //    Buckets are the union of all keys appearing in the inputs.
  const allKeys = new Set<string>([
    ...incomeByBucket.keys(),
    ...mandatoryByBucket.keys(),
    ...budgetsByBucket.keys(),
  ]);
  const planRegistry = getPlanRegistry();
  const allActivePlans = planRegistry.indexes.byStatus.get('active') ?? [];
  const allPausedPlans = planRegistry.indexes.byStatus.get('paused') ?? [];
  const allCompletedPlans = planRegistry.indexes.byStatus.get('completed') ?? [];
  const allPlans = planRegistry.all;

  const headroomByBucket = new Map<string, BucketHeadroom>();
  for (const key of allKeys) {
    const [currencyStr, scope] = key.split('::');
    const currency = currencyStr as CurrencyCode;
    const total = computeHeadroom({
      currency,
      forecastedMonthlyIncome: incomeByBucket.get(key) ?? 0,
      mandatoryMonthly: mandatoryByBucket.get(key) ?? 0,
      categoryBudgets: [{ category: 'aggregate', monthlyCap: budgetsByBucket.get(key) ?? 0 }],
    });
    const avail = availableHeadroom({
      totalHeadroom: total,
      currency,
      scope: scope as PlanScope,
      allPlans,
    });
    const intensityOptions = presentIntensityOptions({
      availableHeadroom: avail,
      goal: { goalType: 'pay-off-debt', targetDateOrAsap: 'ASAP', targetAmount: 0 },
      today,
    });
    headroomByBucket.set(key, {
      currency,
      scope: scope as PlanScope,
      totalHeadroom: total,
      availableHeadroom: avail,
      intensityOptions,
    });
  }

  // 3. Auto-suggested plans (one per uncovered consumer debt, avalanche order).
  const debtSummaries = getAllDebtSummaries({ includeArchived: false }).debts;
  const autoSuggestInputs: AutoSuggestDebt[] = debtSummaries
    .map(debtToAutoSuggestDebt)
    .filter((d): d is AutoSuggestDebt => d !== null);
  const availableHeadroomByBucket = new Map<string, number>();
  for (const [k, v] of headroomByBucket) {
    availableHeadroomByBucket.set(k, v.availableHeadroom);
  }
  const suggestedPlans = autoSuggestPlans({
    debts: autoSuggestInputs,
    persistedPlans: allPlans,
    availableHeadroomByBucket,
    today,
  });

  // 4. Movements + per-plan derived state.
  const movementRegistry = getMovementRegistry();
  const movements = movementRegistry.all;

  // Feasibility per active plan.
  const feasibilityReports = new Map<string, FeasibilityReport>();
  for (const plan of allActivePlans) {
    const bucket = headroomByBucket.get(bucketKey(plan.currency, plan.scope));
    const total = bucket?.totalHeadroom ?? 0;
    feasibilityReports.set(
      plan.id,
      checkPlanFeasibility({ plan, totalHeadroom: total, allActivePlans }),
    );
  }

  // Refinance comparisons for pay-off-debt plans whose target debt has a creditCard config
  // somewhere in the account_config (we expose comparisons for ANY credit-card config that
  // makes sense; v1 just returns one per debt → first card with `creditCard` populated).
  const refinanceComparisons = new Map<string, EvaluateRefinanceTradeoffResult>();
  for (const plan of allActivePlans) {
    if (plan.goal_type !== 'pay-off-debt') continue;
    const debt = debtSummaries.find(d => d.id === plan.target_id);
    if (debt === undefined || debt.kind !== 'consumer') continue;
    if (debt.interestRate === null || debt.matchAmounts.length === 0) continue;
    // Find a credit-card account with a configured creditCard block.
    const ccAccount = Object.values(ACCOUNT_CONFIG_DATA).find(
      c => c.type === 'credit-card' && c.creditCard !== undefined,
    );
    if (ccAccount === undefined || ccAccount.creditCard === undefined) continue;
    refinanceComparisons.set(
      debt.id,
      evaluateRefinanceTradeoffWithToday({
        sourceDebt: {
          balance: debt.currentBalance,
          apr: (debt.interestRate ?? 0) / 100,
          monthlyPayment: debt.matchAmounts[0],
        },
        targetCard: ccAccount.creditCard,
        today,
      }),
    );
  }

  // Auto-completion detection per active plan.
  const targetReachedReports = new Map<string, DetectTargetReachedResult>();
  for (const plan of allActivePlans) {
    if (plan.goal_type === 'pay-off-debt') {
      const debt = debtSummaries.find(d => d.id === plan.target_id);
      const balance = debt?.currentBalance ?? null;
      targetReachedReports.set(plan.id, detectTargetReached({ plan, debtCurrentBalance: balance }));
    } else {
      // save-for-target — caller computes net inflow externally.
      // We default to 0 here so the result is deterministic; the
      // route can re-compute with a real value from transactions.
      targetReachedReports.set(
        plan.id,
        detectTargetReached({ plan, netInflowSinceActivation: 0 }),
      );
    }
  }

  return {
    today,
    headroomByBucket,
    activePlans: allActivePlans,
    pausedPlans: allPausedPlans,
    completedPlans: allCompletedPlans,
    suggestedPlans,
    movements,
    feasibilityReports,
    refinanceComparisons,
    targetReachedReports,
  };
}
