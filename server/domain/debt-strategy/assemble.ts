/**
 * I/O orchestration for §1.9's Debt Strategy planner.
 *
 * Single entrypoint shared by:
 *   - `server/routes/debt-strategy.ts` (the API)
 *   - `server/domain/warnings/plan-*.ts` (the §1.8 spine emitters)
 *
 * The headroom math is now driven by the canonical forecast
 * primitives (a real DRY layer rather than a fourth copy of the
 * loader sequence):
 *
 *   - {@link loadForecastInputs} — single shared loader; same source
 *     of truth as `/api/forecast` and `assembleRunway`.
 *   - {@link projectIncomeForWindow} — named "future income"
 *     primitive. Includes contract accrual (working-days × day-rate
 *     via §1.4's `calculateWorkload`) plus invoice-receipts plus
 *     recurring income. This is the right signal for "next month's
 *     headroom"; the rear-view recurring detector this replaced
 *     would silently zero income on a fresh DB because it requires
 *     several months of consistent transactions to classify.
 *
 * Mandatory outflow uses the same loaded inputs but a different flag
 * combination on `assembleForecastEvents` (mandatory recurring +
 * obligations only). All buckets are pinned to (currency, scope)
 * via {@link bucketKey}.
 */

import {
  type AccountName,
  type CurrencyCode,
} from '../../../shared/api-contracts.js';
import { isMandatoryCategory } from '../../../shared/expenses-insight.js';
import { getAllDebtSummaries, type DebtSummary } from '../../db/repositories/debts.js';
import { listBudgets } from '../../db/repositories/budgets.js';
import { ACCOUNT_CONFIG_DATA } from '../accounts/data.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import {
  loadForecastInputs,
  type LoadedForecastInputs,
} from '../forecast/load-inputs.js';
import { projectMonthlyRunRate } from '../forecast/project-monthly-run-rate.js';

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

/** §1.9 headroom window: 30 days (also used for income run-rate). */
const HEADROOM_WINDOW_DAYS = 30;
/**
 * Forecast horizon for `loadForecastInputs`. 60 days gives the
 * 30-day headroom window plus padding.
 */
const HEADROOM_INPUT_HORIZON_DAYS = 60;

/**
 * Steady-state monthly mandatory outflow per (currency, scope) bucket.
 *
 * Mirrors how `projectMonthlyRunRate` handles income: reads from the
 * pipeline's `monthlyExpenseRecurring` list (the recurring detector's
 * smoothed average) rather than summing point-in-time forecast events
 * over a 30-day window. The windowed approach caused headroom to
 * collapse whenever a large periodic obligation (quarterly VAT, annual
 * insurance, CT payment) happened to fall in the window — inflating
 * mandatory by £10k+ and making headroom appear ~£1,000 regardless of
 * actual income.
 *
 * One-off / periodic obligations (VAT, corp tax, insurance lump-sums)
 * are intentionally excluded from this figure. Those are cash-flow
 * events the user must plan for separately; including them in the
 * monthly headroom baseline would make the planner useless during the
 * months they land.
 */
/** Guard for account-name strings (mirrors the one in project-monthly-run-rate.ts). */
function isKnownAccount(value: string): value is AccountName {
  return value in ACCOUNT_CONFIG_DATA;
}

function buildMandatoryMonthlyByBucket(
  inputs: LoadedForecastInputs,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of inputs.pipeline.monthlyExpenseRecurring) {
    if (!isMandatoryCategory(item.category)) continue;
    const accountStr = item.sourceAccount;
    if (!isKnownAccount(accountStr)) continue;
    const cfg = ACCOUNT_CONFIG_DATA[accountStr];
    const scope = scopeForAccount(accountStr);
    // Use native amount/currency where present (e.g. AED mortgages).
    const native = item.nativeAmount;
    const nativeCurrency = item.nativeCurrency as CurrencyCode | undefined;
    const useNative = native !== undefined && nativeCurrency !== undefined;
    const amount = useNative ? Math.abs(native ?? 0) : Math.abs(item.amount);
    const currency: CurrencyCode = useNative && nativeCurrency !== undefined ? nativeCurrency : cfg.currency;
    if (amount <= 0) continue;
    const key = bucketKey(currency, scope);
    out.set(key, (out.get(key) ?? 0) + amount);
  }
  return out;
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

  // ── Canonical forecast inputs (shared with /api/forecast and runway) ──
  const inputs: LoadedForecastInputs = loadForecastInputs({
    today,
    horizonDays: HEADROOM_INPUT_HORIZON_DAYS,
  });

  // 1a. Income side — `projectMonthlyRunRate` is the steady-state
  //     monthly figure: working-days × day-rate over the next 30 days
  //     for active contracts, plus recurring detected income (rent,
  //     dividends). Already-issued invoice receipts are deliberately
  //     NOT included here — those are back-pay landing in cash on a
  //     specific date, not steady-state monthly income. (For the
  //     date-bounded "what's arriving in the bank between X and Y?"
  //     question, callers use `projectIncomeForWindow` directly.)
  const monthlyIncome = projectMonthlyRunRate({
    today,
    preLoaded: inputs,
    windowDays: HEADROOM_WINDOW_DAYS,
  });
  const incomeByBucket = new Map<string, number>();
  for (const [k, b] of monthlyIncome.byBucket) {
    incomeByBucket.set(k, b.total);
  }
  if (input.incomeOverrides !== undefined) {
    for (const [k, v] of input.incomeOverrides) {
      incomeByBucket.set(k, v);
    }
  }

  // 1b. Mandatory side — steady-state monthly recurring mandatory
  //     outflows (mortgages, insurance, utilities, subscriptions).
  //     One-off periodic obligations (quarterly VAT, annual CT) are
  //     deliberately excluded — those are cash-flow events the user
  //     plans for separately; including them inflates mandatory by
  //     £10k+ in the quarter they land and makes headroom useless.
  const mandatoryByBucket = buildMandatoryMonthlyByBucket(inputs);
  const budgetsByBucket = buildBudgetsByBucket();

  // 2. Compute total + available headroom per bucket.
  //    Always include the three canonical (currency, scope) buckets
  //    so the holistic three-entity view never silently drops one
  //    when the inputs happen to be empty for a slice. Plus the
  //    union of any keys actually appearing in the inputs (covers
  //    future entities or one-off currencies).
  const CANONICAL_BUCKETS: readonly string[] = [
    bucketKey('GBP', 'household'),
    bucketKey('GBP', 'autonize-it-ltd'),
    bucketKey('AED', 'autonize-it-fzco'),
  ];
  const allKeys = new Set<string>([
    ...CANONICAL_BUCKETS,
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
