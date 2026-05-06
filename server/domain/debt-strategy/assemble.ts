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
import { contractDisplayName } from '../../../shared/contract-display.js';
import {
  loadForecastInputs,
  type LoadedForecastInputs,
} from '../forecast/load-inputs.js';
import { projectMonthlyRunRate } from '../forecast/project-monthly-run-rate.js';
import { getClientRegistry } from '../clients/registry.js';

import type { Plan, PlanScope } from './schema.js';
import {
  buildSuggestedPlanPayoffOptions,
  buildActivePlanPayoffSummary,
  type PlanWithPayoffSummary,
  type SuggestedPlanWithPayoffOptions,
} from './suggested-plan-payoff-options.js';
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
import {
  assembleStrategyCapitalSnapshot,
  approxStrategyPeriodMonths,
  buildCreditCardPaydownHints,
  type AssembledStrategyCapitalSnapshot,
  type CreditCardPaydownHint,
} from './strategy-capital.js';
import { recommendRefinanceFromTradeoff, type RefinanceRecommendation } from './recommend-refinance.js';
import { evaluateCrossScopeTransferPlaceholder } from './evaluate-cross-scope-transfer.js';

/** Built once per `assembleDebtStrategy` — single snapshot for routes and proposal logic. */
export interface DebtStrategyContext {
  readonly today: string;
  readonly strategyCapital: AssembledStrategyCapitalSnapshot;
  /** Full forecast load; omitted only in lightweight test doubles. */
  readonly forecastInputs?: LoadedForecastInputs;
  readonly debtsById: ReadonlyMap<string, DebtSummary>;
  readonly strategyPeriodApproxMonths: number;
  readonly availableHeadroomByBucket: ReadonlyMap<string, number>;
  readonly holisticMoneyForDebtGbp: number;
  readonly holisticMoneyForDebtAed: number;
}

export interface BucketHeadroom {
  readonly currency: CurrencyCode;
  readonly scope: PlanScope;
  readonly totalHeadroom: number;
  readonly availableHeadroom: number;
  /** Intensity options computed against the currently-available headroom. */
  readonly intensityOptions: IntensityOptionsResult;
}

export interface SandboxIncomeSourcesLabeled {
  readonly contracts: readonly {
    readonly contractId: string;
    readonly label: string;
    readonly bucketKey: string;
    readonly monthlyAccrual: number;
  }[];
  readonly recurring: readonly {
    readonly key: string;
    readonly label: string;
    readonly bucketKey: string;
    readonly monthlyAmount: number;
    readonly declaredObligationId: string | null;
  }[];
}

export interface AssembledDebtStrategy {
  readonly today: string;
  readonly headroomByBucket: ReadonlyMap<string, BucketHeadroom>;
  readonly activePlans: readonly PlanWithPayoffSummary[];
  readonly pausedPlans: readonly PlanWithPayoffSummary[];
  readonly completedPlans: readonly Plan[];
  readonly suggestedPlans: readonly SuggestedPlanWithPayoffOptions[];
  readonly movements: readonly Movement[];
  readonly feasibilityReports: ReadonlyMap<string, FeasibilityReport>;
  /** Per debt id (only for pay-off-debt plans where target debt + a configured creditCard exist). */
  readonly refinanceComparisons: ReadonlyMap<string, EvaluateRefinanceTradeoffResult>;
  /** Per active plan id. */
  readonly targetReachedReports: ReadonlyMap<string, DetectTargetReachedResult>;
  /** Capital-aware snapshot (deployable money, period cashflows, bill cover). */
  readonly strategyCapital: AssembledStrategyCapitalSnapshot;
  /** Refinance recommendation primitive per consumer debt id (when comparison exists). */
  readonly refinanceRecommendations: ReadonlyMap<string, RefinanceRecommendation>;
  /** Revolving card balances worth targeting for paydown. */
  readonly creditCardPaydownHints: readonly CreditCardPaydownHint[];
  /** Placeholder cross-scope transfer evaluation (phase 2). */
  readonly crossScopeTransferPreview: ReturnType<typeof evaluateCrossScopeTransferPlaceholder>;
  /** Canonical inputs snapshot — avoids re-deriving holistic figures outside this module. */
  readonly debtStrategyContext: DebtStrategyContext;
  /** Income lines the sandbox can toggle (labels for UI). */
  readonly sandboxIncomeSources: SandboxIncomeSourcesLabeled;
}

/**
 * Optional inputs the route can supply for the what-if sandbox to
 * omit specific contract accruals or recurring income rows.
 */
export interface AssembleDebtStrategyInput {
  readonly today?: string;
  readonly incomeExclusions?: {
    readonly excludedContractIds: readonly string[];
    readonly excludedRecurringIncomeKeys: readonly string[];
  };
}

function scopeForAccount(account: AccountName): PlanScope {
  const cfg = ACCOUNT_CONFIG_DATA[account];
  if (cfg.category === 'business') return cfg.entityId;
  return 'household';
}

/** Shared loader horizon for strategy capital (full forecast window). */
const FORECAST_INPUT_HORIZON_DAYS = 720;
/** §1.9 monthly run-rate still uses ~one month of working days. */
const HEADROOM_WINDOW_DAYS = 30;

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
    baselineMonthlyFromMatching: s.matchAmounts[0] ?? 0,
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
    horizonDays: FORECAST_INPUT_HORIZON_DAYS,
  });

  // 1a. Income side — `projectMonthlyRunRate` is the steady-state
  //     monthly figure: working-days × day-rate over the next 30 days
  //     for active contracts, plus recurring detected income (rent,
  //     dividends). Already-issued invoice receipts are deliberately
  //     NOT included here — those are back-pay landing in cash on a
  //     specific date, not steady-state monthly income. (For the
  //     date-bounded "what's arriving in the bank between X and Y?"
  //     question, callers use `projectIncomeForWindow` directly.)
  const fullRunRate = projectMonthlyRunRate({
    today,
    preLoaded: inputs,
    windowDays: HEADROOM_WINDOW_DAYS,
  });
  const exclusions = input.incomeExclusions;
  const hasIncomeExclusions =
    exclusions !== undefined &&
    (exclusions.excludedContractIds.length > 0 ||
      exclusions.excludedRecurringIncomeKeys.length > 0);

  const monthlyIncome = hasIncomeExclusions
    ? projectMonthlyRunRate({
        today,
        preLoaded: inputs,
        windowDays: HEADROOM_WINDOW_DAYS,
        excludedContractIds: exclusions?.excludedContractIds,
        excludedRecurringIncomeKeys: exclusions?.excludedRecurringIncomeKeys,
      })
    : fullRunRate;

  const incomeByBucket = new Map<string, number>();
  for (const [k, b] of monthlyIncome.byBucket) {
    incomeByBucket.set(k, b.total);
  }

  const clients = getClientRegistry();
  const sandboxIncomeSources: SandboxIncomeSourcesLabeled = {
    contracts: fullRunRate.sandboxIncomeSources.contracts.map(c => {
      const contract = inputs.contracts.find(ct => ct.id === c.contractId);
      const label =
        contract !== undefined
          ? contractDisplayName(contract, clients.indexes.byId.get(contract.client_id))
          : c.contractId;
      return {
        contractId: c.contractId,
        label,
        bucketKey: c.bucketKey,
        monthlyAccrual: c.monthlyAccrual,
      };
    }),
    recurring: fullRunRate.sandboxIncomeSources.recurring.map(r => ({
      key: r.key,
      label:
        r.declaredObligationId !== null
          ? `${r.merchant} · ${r.sourceAccount} (declared)`
          : `${r.merchant} · ${r.sourceAccount}`,
      bucketKey: r.bucketKey,
      monthlyAmount: r.monthlyAmount,
      declaredObligationId: r.declaredObligationId,
    })),
  };

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

  const debtSummaries = getAllDebtSummaries({ includeArchived: false }).debts;

  const capitalSnapshot = assembleStrategyCapitalSnapshot({
    inputs,
    activePlans: allActivePlans,
    debts: debtSummaries,
    allPlans,
    maxPlanningDays: FORECAST_INPUT_HORIZON_DAYS,
  });
  const capitalRowByKey = new Map(capitalSnapshot.by_bucket.map(row => [row.key, row]));
  const strategyPeriodApproxMonths = approxStrategyPeriodMonths(
    today,
    capitalSnapshot.strategy_end_date,
  );

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
  const creditCardPaydownHints = buildCreditCardPaydownHints(debtSummaries);
  const autoSuggestInputs: AutoSuggestDebt[] = debtSummaries
    .map(debtToAutoSuggestDebt)
    .filter((d): d is AutoSuggestDebt => d !== null);
  const availableHeadroomByBucket = new Map<string, number>();
  for (const [k, v] of headroomByBucket) {
    availableHeadroomByBucket.set(k, v.availableHeadroom);
  }

  const debtsById = new Map(debtSummaries.map(d => [d.id, d] as const));
  const debtStrategyContext: DebtStrategyContext = {
    today,
    strategyCapital: capitalSnapshot,
    forecastInputs: inputs,
    debtsById,
    strategyPeriodApproxMonths,
    availableHeadroomByBucket,
    holisticMoneyForDebtGbp: capitalSnapshot.holistic.holistic_money_for_debt_gbp,
    holisticMoneyForDebtAed: capitalSnapshot.holistic.holistic_money_for_debt_aed,
  };

  const suggestedPlansRaw = autoSuggestPlans({
    debts: autoSuggestInputs,
    persistedPlans: allPlans,
    availableHeadroomByBucket,
    today,
    strategyPeriodApproxMonths,
    holisticMoneyForDebtGbp: capitalSnapshot.holistic.holistic_money_for_debt_gbp,
    holisticMoneyForDebtAed: capitalSnapshot.holistic.holistic_money_for_debt_aed,
  });

  const lumpByDebtId = new Map(
    capitalSnapshot.recommended_lump_sum_allocations.map(
      a => [a.debt_id, a.recommended_lump_sum] as const,
    ),
  );

  const suggestedPlans: SuggestedPlanWithPayoffOptions[] = suggestedPlansRaw.map(sp => {
    const tid = sp.target_id;
    if (tid === null) {
      throw new Error(`invariant: suggested plan ${sp.id} missing target_id`);
    }
    const debt = debtsById.get(tid);
    if (debt === undefined) {
      throw new Error(`invariant: debt ${tid} missing for suggested plan ${sp.id}`);
    }
    const headroom = availableHeadroomByBucket.get(bucketKey(sp.currency, sp.scope)) ?? 0;
    const holisticMoneyForDebt =
      sp.currency === 'AED'
        ? capitalSnapshot.holistic.holistic_money_for_debt_aed
        : capitalSnapshot.holistic.holistic_money_for_debt_gbp;
    const payoff_options = buildSuggestedPlanPayoffOptions({
      suggested: sp,
      debt,
      availableHeadroom: headroom,
      holisticMoneyForDebt,
      strategyPeriodApproxMonths,
      today,
      oneShotLumpAmount: lumpByDebtId.get(tid),
    });
    return { ...sp, payoff_options };
  });

  // 4. Movements + per-plan derived state.
  const movementRegistry = getMovementRegistry();
  const movements = movementRegistry.all;

  function enrichPlanWithPayoffSummary(plan: Plan): PlanWithPayoffSummary {
    const supplementalFromMovements = movements
      .filter(m => m.plan_id === plan.id)
      .reduce((sum, m) => sum + m.amount, 0);
    const debt =
      plan.target_id !== null ? debtsById.get(plan.target_id) : undefined;
    const payoff_summary = buildActivePlanPayoffSummary({
      plan,
      debt,
      supplementalFromMovements,
    });
    return { ...plan, payoff_summary };
  }

  const activePlansWithPayoff = allActivePlans.map(enrichPlanWithPayoffSummary);
  const pausedPlansWithPayoff = allPausedPlans.map(enrichPlanWithPayoffSummary);

  // Feasibility per active plan.
  const feasibilityReports = new Map<string, FeasibilityReport>();
  for (const plan of allActivePlans) {
    const bucket = headroomByBucket.get(bucketKey(plan.currency, plan.scope));
    const total = bucket?.totalHeadroom ?? 0;
    const capitalRow = capitalRowByKey.get(bucketKey(plan.currency, plan.scope));
    feasibilityReports.set(
      plan.id,
      checkPlanFeasibility({
        plan,
        totalHeadroom: total,
        allActivePlans,
        monthsOfBillCoverAfterPlan: capitalRow?.months_of_bill_cover_after_plan ?? null,
      }),
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

  const refinanceRecommendations = new Map<string, RefinanceRecommendation>();
  for (const [debtId, comparison] of refinanceComparisons) {
    refinanceRecommendations.set(debtId, recommendRefinanceFromTradeoff(comparison));
  }

  const crossScopeTransferPreview = evaluateCrossScopeTransferPlaceholder({
    sourceScope: 'household',
    targetScope: 'autonize-it-ltd',
    sourceCurrency: 'GBP',
    targetCurrency: 'GBP',
  });

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
    activePlans: activePlansWithPayoff,
    pausedPlans: pausedPlansWithPayoff,
    completedPlans: allCompletedPlans,
    suggestedPlans,
    movements,
    feasibilityReports,
    refinanceComparisons,
    targetReachedReports,
    strategyCapital: capitalSnapshot,
    refinanceRecommendations,
    creditCardPaydownHints,
    crossScopeTransferPreview,
    debtStrategyContext,
    sandboxIncomeSources,
  };
}
