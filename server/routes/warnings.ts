/**
 * /api/warnings — consolidated warnings spine (Roadmap 1.8).
 *
 * Route map:
 *   GET /api/warnings/entity-foundation
 *     The original entity-foundation feed, now extended with §1.6
 *     runway thresholds, §1.7 income-composition risk signals, §1.8
 *     tax-reserve + ad-hoc spend warnings, and snapshot-diff
 *     improvement-feedback entries (`warning-improved` /
 *     `warning-cleared`). The route's name is legacy from §1.1
 *     Phase 7 — its content is the consolidated feed.
 *   GET /api/warnings/all
 *     Alias of the above. Same payload; clearer name for new readers.
 *   GET /api/warnings/inter-company-movements
 *     UK Ltd ↔ UAE FZCO candidate-pair classification queue (Phase 8).
 *   POST /api/warnings/inter-company-movements/classify
 *     Persist a classification for one pair (Phase 8).
 */

import express, { Request, Response } from 'express';
import { getDb } from '../db/connection.js';
import { ACCOUNTS } from '../../shared/api-contracts.js';
import type { AccountName } from '../../shared/api-contracts.js';
import { allCompanies } from '../domain/company/index.js';
import { allClients } from '../domain/clients/index.js';
import { allContracts } from '../domain/contracts/queries.js';
import { allInvoices } from '../domain/invoices/index.js';
import { deriveEntityFoundationWarnings } from '../domain/warnings/entity-foundation.js';
import { sumFzcoTrailing12mIncomeAed } from '../domain/warnings/fzco-income.js';
import { countUnclassifiedInterCompanyPairs } from '../domain/warnings/inter-company-count.js';
import { derivePaymentOutsideContractWindowWarnings } from '../domain/warnings/payment-outside-contract-window.js';
import { deriveInvoiceRowWarnings } from '../domain/warnings/invoice-reconciler.js';
import { deriveInvoiceDaysMismatchWarnings } from '../domain/warnings/invoice-days-mismatch.js';
import { holidayDatesForEntity } from '../domain/working-days/public-holidays.js';
import { allLeave } from '../domain/leave/index.js';
import { buildInterCompanyMovementsResponse } from '../domain/inter-company/movements-response.js';
import { classifyInterCompanyPair } from '../domain/transaction-overrides/classify-pair.js';
// §1.6
import { assembleRunway } from '../domain/forecast/index.js';
import { deriveRunwayThresholdWarnings } from '../domain/warnings/runway-thresholds.js';
// §1.7
import { assembleIncomeComposition } from '../domain/income-composition/index.js';
import { formatRiskSignalAsWarning } from '../domain/warnings/risk-signal-to-warning.js';
// §1.8 new
import { allReserves } from '../domain/reserves/index.js';
import { deriveTaxReserveWarnings } from '../domain/warnings/tax-reserve.js';
import { deriveAdHocSpendWarnings } from '../domain/warnings/ad-hoc-spend.js';
// §1.9 — Debt Strategy emitters
import { listDebts } from '../db/repositories/debts.js';
import { ACCOUNT_CONFIG_DATA } from '../domain/accounts/data.js';
import { assembleDebtStrategy } from '../domain/debt-strategy/assemble.js';
import { listMovementsByPlan } from '../domain/debt-strategy/movements-queries.js';
import { deriveMortgageRateResetWarnings } from '../domain/warnings/mortgage-rate-reset.js';
import { deriveDebtUnregisteredWarnings } from '../domain/warnings/debt-unregistered.js';
import { deriveAccountCreditCardConfigMissingWarnings } from '../domain/warnings/account-credit-card-config-missing.js';
import { derivePlanBlockedIncompleteBudgetsWarnings } from '../domain/warnings/plan-blocked-incomplete-budgets.js';
import { derivePlanFeasibilityDegradedWarnings } from '../domain/warnings/plan-feasibility-degraded.js';
import { derivePlanTargetReachedWarnings } from '../domain/warnings/plan-target-reached.js';
import type { AccountConfig } from '../domain/accounts/schema.js';
import {
  diffAgainstPreviousSnapshot,
  findPreviousSnapshotAt,
  loadSnapshot,
  recordSnapshot,
  trimSnapshotsBefore,
} from '../domain/warnings/snapshots.js';
import { runExpensesOverviewPipeline } from '../utils/expenses-overview-pipeline.js';
import { getUpcomingObligations, toApiObligation } from '../db/repositories/obligations.js';
import { getAllAccountBalances } from '../db/repositories/balance.js';
import { getTransactions } from '../db/repositories/transactions.js';
import { transactionRowToRaw } from '../utils/expenses-overview-pipeline.js';
import { listBudgets } from '../db/repositories/budgets.js';
import { todayIsoLocal } from '../../shared/iso-date.js';
import {
  EntityFoundationWarningsResponseSchema,
  InterCompanyMovementsResponseSchema,
  InterCompanyClassifyRequestSchema,
  type EntityFoundationWarning,
  type WarningSeverity,
} from '../../shared/api-contracts.js';

const router = express.Router();

const SEVERITY_RANK: Record<WarningSeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

/**
 * Default TTL for snapshot rows. 90 days is enough history to spot a
 * "concentration was 100%, now 60%" trajectory while keeping the table
 * tiny.
 */
const SNAPSHOT_TTL_DAYS = 90;

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
    const txns = getTransactions({ account: name });
    let net = 0;
    for (const t of txns) {
      if (t.date < cutoff) continue;
      net += t.amount; // signed: income +ve, expense -ve
    }
    map.set(name, net / 3);
  }
  return map;
}

async function handleAllWarnings(_req: Request, res: Response): Promise<void> {
  try {
    const db = getDb();
    const today = new Date();
    const todayIso = todayIsoLocal();
    const nowIso = today.toISOString();

    // ── Existing emitters ───────────────────────────────────────────
    const foundationWarnings = deriveEntityFoundationWarnings({
      companies: allCompanies(),
      clients: allClients(),
      contracts: allContracts(),
      fzcoTrailing12mIncomeAed: sumFzcoTrailing12mIncomeAed(db, today),
      interCompanyMovementCount: countUnclassifiedInterCompanyPairs(db),
      today,
    });

    const paymentWindowWarnings = derivePaymentOutsideContractWindowWarnings(db, today);

    const contractsById = new Map(allContracts().map(c => [c.id, c] as const));
    const invoices = allInvoices();
    const invoiceRowWarnings = deriveInvoiceRowWarnings({ invoices, contractsById });

    const contracts = allContracts();
    const entityIds = [...new Set(contracts.map(c => c.issuing_entity_id))];
    const publicHolidayDatesByEntity = new Map(
      entityIds.map(eid => [eid, holidayDatesForEntity(eid, '2025-01-01', '2027-12-31')] as const),
    );
    const daysMismatchWarnings = deriveInvoiceDaysMismatchWarnings({
      invoices,
      contractsById,
      leaveRows: allLeave(),
      publicHolidayDatesByEntity,
    });

    // ── §1.7 risk signals → warnings ────────────────────────────────
    const incomeComposition = assembleIncomeComposition();
    const riskSignalWarnings = incomeComposition.riskSignals.map(formatRiskSignalAsWarning);

    // ── §1.6 runway thresholds → warnings ───────────────────────────
    const assembledRunway = assembleRunway();
    const runwayWarnings = deriveRunwayThresholdWarnings(assembledRunway);

    // ── §1.8 tax-reserve warnings ───────────────────────────────────
    const upcomingObligations = getUpcomingObligations(120).map(toApiObligation);
    const taxReserveWarnings = deriveTaxReserveWarnings({
      today: todayIso,
      reserves: allReserves(),
      obligations: upcomingObligations,
      balanceByAccount: buildBalanceByAccount(),
      monthlyContributionByAccount: buildMonthlyContributionByAccount(todayIso),
    });

    // ── §1.8 ad-hoc spend escalation ────────────────────────────────
    const pipeline = runExpensesOverviewPipeline();
    const expenseTxns = getTransactions({ type: 'expense' }).map(transactionRowToRaw);
    const budgetedCategories = new Set(listBudgets({}).map(b => b.category));
    const adHocSpendWarnings = deriveAdHocSpendWarnings({
      today: todayIso,
      expenseTransactions: expenseTxns,
      pipeline,
      budgetedCategories,
    });

    // ── §1.9 Debt Strategy warnings ─────────────────────────────────
    const debts = listDebts({ includeArchived: false });
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

    const accountCcConfigMissingWarnings =
      deriveAccountCreditCardConfigMissingWarnings({ accounts });

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

    const baseWarnings: EntityFoundationWarning[] = [
      ...foundationWarnings,
      ...paymentWindowWarnings,
      ...invoiceRowWarnings,
      ...daysMismatchWarnings,
      ...riskSignalWarnings,
      ...runwayWarnings,
      ...taxReserveWarnings,
      ...adHocSpendWarnings,
      // §1.9
      ...mortgageRateResetWarnings,
      ...debtUnregisteredWarnings,
      ...accountCcConfigMissingWarnings,
      ...incompleteBudgetsWarnings,
      ...feasibilityWarnings,
      ...targetReachedWarnings,
    ];

    // ── §1.8 improvement feedback ───────────────────────────────────
    const previousAt = findPreviousSnapshotAt(db, nowIso);
    const previousSnapshot = previousAt !== null ? loadSnapshot(db, previousAt) : [];
    const improvementWarnings = diffAgainstPreviousSnapshot({
      now: nowIso,
      currentWarnings: baseWarnings,
      previousSnapshot,
      previousSnapshotAt: previousAt ?? '',
    });

    const warnings = [...baseWarnings, ...improvementWarnings];

    // Stable sort: severity rank, then code (so the same input → same output).
    warnings.sort((a, b) => {
      const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sev !== 0) return sev;
      return a.code.localeCompare(b.code);
    });

    // Persist today's snapshot and trim old rows. Do this AFTER sorting
    // so the stored set matches the response. Don't snapshot the diff
    // entries — they are derived from the snapshot, not part of it.
    recordSnapshot(db, nowIso, baseWarnings);
    trimSnapshotsBefore(db, shiftIsoTimestamp(nowIso, -SNAPSHOT_TTL_DAYS));

    const body = EntityFoundationWarningsResponseSchema.parse({ warnings });
    res.json(body);
  } catch (error) {
    console.error('[Warnings] GET /entity-foundation error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to derive entity-foundation warnings: ${message}` });
  }
}

// `/entity-foundation` is the legacy name (§1.1 Phase 7). `/all` is
// the forward-naming alias for §1.8's consolidated spine — same handler,
// same payload. The legacy path stays so existing UI continues to work
// without change.
router.get('/entity-foundation', handleAllWarnings);
router.get('/all', handleAllWarnings);

router.get('/inter-company-movements', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const payload = buildInterCompanyMovementsResponse(db);
    const body = InterCompanyMovementsResponseSchema.parse(payload);
    res.json(body);
  } catch (error) {
    console.error('[Warnings] GET /inter-company-movements error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to list inter-company movements: ${message}` });
  }
});

router.post('/inter-company-movements/classify', (req: Request, res: Response) => {
  const parsed = InterCompanyClassifyRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({
      error: `Invalid classify request: ${issue.path.join('.') || '(root)'} — ${issue.message}`,
    });
    return;
  }

  try {
    const db = getDb();
    const result = classifyInterCompanyPair(db, {
      expenseHash: parsed.data.expenseHash,
      incomeHash: parsed.data.incomeHash,
      category: parsed.data.category,
      notes: parsed.data.notes ?? null,
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const payload = buildInterCompanyMovementsResponse(db);
    const body = InterCompanyMovementsResponseSchema.parse(payload);
    res.json(body);
  } catch (error) {
    console.error('[Warnings] POST /inter-company-movements/classify error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to classify inter-company pair: ${message}` });
  }
});

export default router;
