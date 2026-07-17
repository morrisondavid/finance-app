/**
 * Consolidated Warnings feed (§1.8 spine) — single builder used by
 * `GET /api/warnings/{entity-foundation,all}` and `GET /api/ai/warnings`.
 */

import type Database from 'better-sqlite3';
import { ACCOUNTS } from '../../../shared/api-contracts.js';
import type { AccountName } from '../../../shared/api-contracts.js';
import {
  EntityFoundationWarningsResponseSchema,
  type EntityFoundationWarning,
  type WarningSeverity,
} from '../../../shared/api-contracts.js';
import { shiftIsoDate, todayIsoLocal } from '../../../shared/iso-date.js';
import { listWarningUserStateMap } from '../../db/repositories/warning-user-state.js';
import { allCompanies } from '../company/index.js';
import { allClients } from '../clients/index.js';
import { allContracts } from '../contracts/queries.js';
import {
  allInvoices,
  buildEntityReconciliationPlan,
  RECONCILE_LOOKBACK_DAYS,
} from '../invoices/index.js';
import { allLeave } from '../leave/index.js';
import { assembleRunway } from '../forecast/index.js';
import type { PipelineResult } from '../../utils/recurring-pipeline.js';
import type { LoadedForecastInputs } from '../forecast/load-inputs.js';
import type { AssembledRunway } from '../forecast/assemble-runway.js';
import { assembleIncomeComposition } from '../income-composition/index.js';
import { allReserves } from '../reserves/index.js';
import { assembleDebtStrategy } from '../debt-strategy/assemble.js';
import { listMovementsByPlan } from '../debt-strategy/movements-queries.js';
import { getPlanRegistry } from '../debt-strategy/registry.js';
import { getMovementRegistry } from '../debt-strategy/movements-registry.js';
import { findLastPlanTransferMatchDate } from '../debt-strategy/match-plan-transfer.js';
import { ACCOUNT_CONFIG_DATA } from '../accounts/data.js';
import type { AccountConfig } from '../accounts/schema.js';
import { holidayDatesForEntity } from '../working-days/public-holidays.js';
import { deriveEntityFoundationWarnings } from './entity-foundation.js';
import { sumFzcoTrailing12mIncomeAed } from './fzco-income.js';
import { countUnclassifiedInterCompanyPairs } from './inter-company-count.js';
import { derivePaymentOutsideContractWindowWarnings } from './payment-outside-contract-window.js';
import {
  deriveInvoiceRowWarnings,
  deriveUnmatchedDepositWarnings,
} from './invoice-reconciler.js';
import { deriveInvoiceDaysMismatchWarnings } from './invoice-days-mismatch.js';
import { deriveRunwayThresholdWarnings } from './runway-thresholds.js';
import { formatRiskSignalAsWarning } from './risk-signal-to-warning.js';
import { deriveTaxReserveWarnings, maxReserveLookaheadDays } from './tax-reserve.js';
import { deriveAccountantPackIncompleteWarnings } from './accountant-pack-incomplete.js';
import {
  computeReportingReadiness,
  getReportingManifest,
  mostRecentlyEndedFyLabel,
  mostRecentlyEndedVatQuarterLabel,
} from '../reporting/index.js';
import { deriveAdHocSpendWarnings } from './ad-hoc-spend.js';
import {
  deriveCategorySpendSurgeWarnings,
  deriveDiscretionaryBurnWarnings,
} from './discretionary-spend.js';
import { deriveMortgageRateResetWarnings } from './mortgage-rate-reset.js';
import { deriveAllFeedSyncScheduledWarnings } from './feed-sync-scheduled.js';
import { deriveDebtUnregisteredWarnings } from './debt-unregistered.js';
import { deriveAccountCreditCardConfigMissingWarnings } from './account-credit-card-config-missing.js';
import { deriveCreditCardRecurringSpendWarnings } from './credit-card-recurring-spend.js';
import { derivePlanBlockedIncompleteBudgetsWarnings } from './plan-blocked-incomplete-budgets.js';
import { derivePlanFeasibilityDegradedWarnings } from './plan-feasibility-degraded.js';
import { derivePlanTargetReachedWarnings } from './plan-target-reached.js';
import {
  derivePlanTransferWarnings,
  PLAN_TRANSFER_MISSED_LOOKBACK_DAYS,
  type MovementMatchInput,
} from './plan-transfer.js';
import {
  diffAgainstPreviousSnapshot,
  findPreviousSnapshotAt,
  loadSnapshot,
  recordSnapshot,
  trimSnapshotsBefore,
} from './snapshots.js';
import { enrichWarningsForAgents, warningPassesListingFilter } from './enrich-for-agents.js';
import { runExpensesOverviewPipeline, transactionRowToRaw } from '../../utils/expenses-overview-pipeline.js';
import { runExpensesOverviewPipelineWithReadContext } from '../../http/read-context.js';
import { ROLLING_MONTHS, rollingCutoffIsoDate } from '../../utils/math.js';
import { obligationsForTaxReserveWarnings, toApiObligation } from '../../db/repositories/obligations.js';
import { getAllAccountBalances } from '../../db/repositories/balance.js';
import { getTransactions } from '../../db/repositories/transactions.js';
import { listBudgets } from '../../db/repositories/budgets.js';
import { listDebts } from '../../db/repositories/debts.js';

const SEVERITY_RANK: Record<WarningSeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

/** Default snapshot TTL: trim rows older than this many days. */
const SNAPSHOT_TTL_DAYS = 90;

/**
 * Expenses for ad-hoc + debt-unregistered warning paths only.
 * Matches the rolling scope used by {@link runExpensesOverviewPipeline}
 * (`ROLLING_MONTHS`) so nudges / recurring-key alignment see the same horizon
 * as the overview tab without scanning all-time rows.
 */
function expenseTransactionsForConsolidatedWarnings(): ReturnType<typeof transactionRowToRaw>[] {
  const minDate = rollingCutoffIsoDate(ROLLING_MONTHS);
  return getTransactions({ type: 'expense', minDateInclusive: minDate }).map(transactionRowToRaw);
}

function shiftIsoTimestamp(now: string, days: number): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function buildBalanceByAccount(): Map<AccountName, number> {
  const map = new Map<AccountName, number>();
  const balances = getAllAccountBalances();
  for (const name of ACCOUNTS) {
    map.set(name, balances[name].currentBalance);
  }
  return map;
}

/**
 * Average net inflow per account over rolling 90 days, divided by 3 to
 * give a monthly contribution rate. Used by the tax-reserve trajectory
 * check.
 */
function buildMonthlyContributionByAccount(today: string): Map<AccountName, number> {
  const cutoff = shiftIsoTimestamp(today, -90).slice(0, 10);
  const map = new Map<AccountName, number>();
  for (const name of ACCOUNTS) {
    const txns = getTransactions({ account: name, minDateInclusive: cutoff });
    let net = 0;
    for (const t of txns) {
      net += t.amount;
    }
    map.set(name, net / 3);
  }
  return map;
}

export interface BuildConsolidatedWarningsPreloaded {
  readonly pipeline?: PipelineResult;
  readonly forecastInputs?: LoadedForecastInputs;
  readonly assembledRunway?: AssembledRunway;
}

export interface BuildConsolidatedWarningsOptions {
  /** When true (default), hide warnings whose user state has snoozedUntil > today. */
  readonly applySnoozeListingFilter?: boolean;
  /** Request-scoped reuse — avoids duplicate pipeline / runway work. */
  readonly preloaded?: BuildConsolidatedWarningsPreloaded;
}

export function buildConsolidatedWarningsResponse(
  db: Database.Database,
  options: BuildConsolidatedWarningsOptions = {},
): ReturnType<typeof EntityFoundationWarningsResponseSchema.parse> {
  const applySnoozeListingFilter = options.applySnoozeListingFilter ?? true;
  const today = new Date();
  const todayIso = todayIsoLocal();
  const nowIso = today.toISOString();

  const contracts = allContracts();
  const entityIdsForHolidays = [...new Set(contracts.map(c => c.issuing_entity_id))];
  const publicHolidayDatesByEntity = new Map(
    entityIdsForHolidays.map(eid => [eid, holidayDatesForEntity(eid, '2025-01-01', '2027-12-31')] as const),
  );

  const foundationWarnings = deriveEntityFoundationWarnings({
    companies: allCompanies(),
    clients: allClients(),
    contracts,
    leaveRows: allLeave(),
    publicHolidayDatesByEntity,
    fzcoTrailing12mIncomeAed: sumFzcoTrailing12mIncomeAed(db, today),
    interCompanyMovementCount: countUnclassifiedInterCompanyPairs(db),
    today,
  });

  const paymentWindowWarnings = derivePaymentOutsideContractWindowWarnings(db, today);

  const contractsById = new Map(contracts.map(c => [c.id, c] as const));
  const invoices = allInvoices();
  const invoiceRowWarnings = deriveInvoiceRowWarnings({ invoices, todayIso });

  const daysMismatchWarnings = deriveInvoiceDaysMismatchWarnings({
    invoices,
    contractsById,
    leaveRows: allLeave(),
  });

  const incomeComposition = assembleIncomeComposition();
  const riskSignalWarnings = incomeComposition.riskSignals.map(formatRiskSignalAsWarning);

  const assembledRunway =
    options.preloaded?.assembledRunway ??
    assembleRunway(
      options.preloaded?.forecastInputs !== undefined
        ? { forecastInputs: options.preloaded.forecastInputs }
        : {},
    );
  const runwayWarnings = deriveRunwayThresholdWarnings(assembledRunway);

  const reserves = allReserves();
  const taxReserveObligations = obligationsForTaxReserveWarnings(
    maxReserveLookaheadDays(reserves),
  ).map(toApiObligation);
  const taxReserveWarnings = deriveTaxReserveWarnings({
    today: todayIso,
    reserves,
    obligations: taxReserveObligations,
    balanceByAccount: buildBalanceByAccount(),
    monthlyContributionByAccount: buildMonthlyContributionByAccount(todayIso),
  });

  const pipeline =
    options.preloaded?.pipeline ?? runExpensesOverviewPipelineWithReadContext();
  const expenseTxns = expenseTransactionsForConsolidatedWarnings();
  const budgetedCategories = new Set(listBudgets({}).map(b => b.category));
  const debts = listDebts({ includeArchived: false });
  const adHocSpendWarnings = deriveAdHocSpendWarnings({
    today: todayIso,
    expenseTransactions: expenseTxns,
    pipeline,
    budgetedCategories,
    activeDebts: debts,
  });
  const discretionarySpendInput = {
    today: todayIso,
    expenseTransactions: expenseTxns,
    pipeline,
    budgetedCategories,
    activeDebts: debts,
  };
  const categorySpendSurgeWarnings = deriveCategorySpendSurgeWarnings(discretionarySpendInput);
  const discretionaryBurnWarnings = deriveDiscretionaryBurnWarnings(discretionarySpendInput);
  const accounts: readonly AccountConfig[] = Object.values(ACCOUNT_CONFIG_DATA);

  const mortgageRateResetWarnings = deriveMortgageRateResetWarnings({
    today: todayIso,
    debts,
  });

  const debtUnregisteredWarnings = deriveDebtUnregisteredWarnings({
    expenseTransactions: expenseTxns,
    pipeline,
    budgetedCategories,
    debts,
  });

  const accountCcConfigMissingWarnings = deriveAccountCreditCardConfigMissingWarnings({ accounts });
  const creditCardRecurringSpendWarnings = deriveCreditCardRecurringSpendWarnings({
    accounts,
    pipeline,
  });

  const debtStrategy = assembleDebtStrategy({ today: todayIso });
  const hasPlansNeedingBudgets =
    debtStrategy.activePlans.length > 0 || debtStrategy.suggestedPlans.length > 0;
  const incompleteBudgetsWarnings = derivePlanBlockedIncompleteBudgetsWarnings({
    hasPlansNeedingBudgets,
    budgetedCategories,
  });

  const feasibilityWarnings = derivePlanFeasibilityDegradedWarnings({
    reports: debtStrategy.activePlans.map(plan => ({
      plan,
      report: debtStrategy.feasibilityReports.get(plan.id) ?? {
        status: 'ok',
        gap: 0,
        requiredAllocation: plan.monthly_allocation,
        currentAvailable: plan.monthly_allocation,
        suggestedRemedies: [],
        months_of_bill_cover_after_plan: null,
        bill_cover_viable: true,
      },
    })),
  });

  const targetReachedWarnings = derivePlanTargetReachedWarnings({
    today: todayIso,
    items: debtStrategy.activePlans.map(plan => ({
      plan,
      report:
        debtStrategy.targetReachedReports.get(plan.id) ?? {
          reached: false,
          evidence: { kind: 'not-reached' },
        },
      acknowledgedMovements: listMovementsByPlan(plan.id).filter(
        m => m.acknowledged_at !== null,
      ),
    })),
  });

  const planRegistry = getPlanRegistry();
  const movementRegistry = getMovementRegistry();
  const movementMatches: MovementMatchInput[] = [];
  for (const movement of movementRegistry.all) {
    const plan = planRegistry.indexes.byId.get(movement.plan_id);
    if (plan === undefined || plan.status !== 'active') continue;
    const txns = getTransactions({ account: movement.from_account });
    const lastMatchedDate = findLastPlanTransferMatchDate({
      movement,
      transactionsOnFromAccount: txns,
      today: todayIso,
      lookbackDays: PLAN_TRANSFER_MISSED_LOOKBACK_DAYS,
    });
    movementMatches.push({ plan, movement, lastMatchedDate });
  }
  const planTransferWarnings = derivePlanTransferWarnings({
    today: todayIso,
    movementMatches,
  });

  const ukLtdEntity: 'autonize-it-ltd' = 'autonize-it-ltd';
  const vatPeriodLabel = mostRecentlyEndedVatQuarterLabel(new Date(`${todayIso}T12:00:00`));
  const ctPeriodLabel = mostRecentlyEndedFyLabel(new Date(`${todayIso}T12:00:00`));
  const vatReadiness = computeReportingReadiness({
    entityId: ukLtdEntity,
    regime: 'vat',
    periodLabel: vatPeriodLabel,
  });
  const ctReadiness = computeReportingReadiness({
    entityId: ukLtdEntity,
    regime: 'corporation_tax',
    periodLabel: ctPeriodLabel,
  });
  const ukLtdReconcilePlan = buildEntityReconciliationPlan({
    entityId: ukLtdEntity,
    windowStart: shiftIsoDate(todayIso, -RECONCILE_LOOKBACK_DAYS),
    windowEnd: todayIso,
    now: todayIso,
  });
  const unmatchedDepositWarnings = deriveUnmatchedDepositWarnings({
    plan: ukLtdReconcilePlan,
    entityId: ukLtdEntity,
  });

  const accountantPackWarnings = deriveAccountantPackIncompleteWarnings([
    {
      entityId: ukLtdEntity,
      regime: 'vat',
      periodLabel: vatPeriodLabel,
      readiness: vatReadiness,
      graceDays: getReportingManifest(ukLtdEntity, 'vat').graceDays,
      today: todayIso,
    },
    {
      entityId: ukLtdEntity,
      regime: 'corporation_tax',
      periodLabel: ctPeriodLabel,
      readiness: ctReadiness,
      graceDays: getReportingManifest(ukLtdEntity, 'corporation_tax').graceDays,
      today: todayIso,
    },
  ]);

  const baseWarnings: EntityFoundationWarning[] = [
    ...foundationWarnings,
    ...paymentWindowWarnings,
    ...invoiceRowWarnings,
    ...unmatchedDepositWarnings,
    ...daysMismatchWarnings,
    ...riskSignalWarnings,
    ...runwayWarnings,
    ...taxReserveWarnings,
    ...adHocSpendWarnings,
    ...categorySpendSurgeWarnings,
    ...discretionaryBurnWarnings,
    ...mortgageRateResetWarnings,
    ...debtUnregisteredWarnings,
    ...accountCcConfigMissingWarnings,
    ...creditCardRecurringSpendWarnings,
    ...incompleteBudgetsWarnings,
    ...feasibilityWarnings,
    ...targetReachedWarnings,
    ...planTransferWarnings,
    ...accountantPackWarnings,
    ...deriveAllFeedSyncScheduledWarnings(),
  ];

  const previousAt = findPreviousSnapshotAt(db, nowIso);
  const previousSnapshot = previousAt !== null ? loadSnapshot(db, previousAt) : [];
  const improvementWarnings = diffAgainstPreviousSnapshot({
    now: nowIso,
    currentWarnings: baseWarnings,
    previousSnapshot,
    previousSnapshotAt: previousAt ?? '',
  });

  const warnings = [...baseWarnings, ...improvementWarnings];

  const TAX_RESERVE_SORT_BOOST: Partial<Record<string, number>> = {
    'tax-reserve-underfunded': 0,
    'tax-reserve-trajectory-missing': 1,
  };

  warnings.sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    const boostA = TAX_RESERVE_SORT_BOOST[a.code] ?? 10;
    const boostB = TAX_RESERVE_SORT_BOOST[b.code] ?? 10;
    if (boostA !== boostB) return boostA - boostB;
    return a.code.localeCompare(b.code);
  });

  recordSnapshot(db, nowIso, baseWarnings);
  trimSnapshotsBefore(db, shiftIsoTimestamp(nowIso, -SNAPSHOT_TTL_DAYS));

  const userMap = listWarningUserStateMap(db);
  const enriched = enrichWarningsForAgents(db, warnings, userMap);
  const listed = applySnoozeListingFilter
    ? enriched.filter(w => warningPassesListingFilter(w, todayIso))
    : enriched;

  return EntityFoundationWarningsResponseSchema.parse({ warnings: listed });
}
