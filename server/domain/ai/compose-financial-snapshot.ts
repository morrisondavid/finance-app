/**
 * §2.1 Financial Snapshot — composed agent read (liquidity, runway, income,
 * near-term obligations slice, budget nudges, verdict).
 */

import type {
  AiFinancialSnapshotResponse,
  AiPipelineResponse,
  EntityId,
} from '../../../shared/api-contracts.js';
import { AiFinancialSnapshotResponseSchema } from '../../../shared/api-contracts.js';
import { shiftIsoDate } from '../../../shared/iso-date.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import { getAvailableFinancialYears, getTransactions } from '../../db/index.js';
import { listBudgets } from '../../db/repositories/budgets.js';
import { normalizeFinancialYear } from '../../db/utils/financial-year.js';
import { round2 } from '../../utils/math.js';
import {
  buildExpensePipelineForAccount,
  transactionRowToRaw,
} from '../../utils/expenses-overview-pipeline.js';
import { computeBudgetNudges } from '../../utils/budget-nudges.js';
import { validateAccount } from '../accounts/queries.js';
import { buildAggregateAccrualResponse } from '../contracts/aggregate-accrual.js';
import { assembleRunway } from '../forecast/index.js';
import { runwayResponseFromAssembled } from '../forecast/runway-api-response.js';
import { loadForecastInputs } from '../forecast/load-inputs.js';
import { allInvoicePayments, allInvoices, outstandingInvoicesGbpSummary } from '../invoices/index.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';
import { composeAiLiquidity } from './compose-liquidity.js';
import { buildAiPipelineFromLoaded } from './compose-pipeline.js';
import { deriveFinancialVerdict } from './derive-financial-verdict.js';

export interface ComposeAiFinancialSnapshotOpts {
  readonly horizonDays?: number;
  /** Obligation-only pipeline window; clamped to `horizonDays`. Default 90. */
  readonly commitmentDays?: number;
  readonly filterEntityId?: EntityId;
  readonly runwayDetail?: 'accounts' | 'summary';
  readonly account?: string;
  readonly financialYear?: string;
  readonly groupByEntity?: boolean;
}

function sumObligationOutflowsGbpInWindow(
  pipeline: AiPipelineResponse,
  today: string,
  windowDays: number,
): { endDate: string; committedOutflowsGbp: number } {
  const endDate = shiftIsoDate(today, windowDays);
  let sum = 0;
  for (const row of pipeline.rows) {
    if (row.kind !== 'obligation') continue;
    if (row.date < today || row.date > endDate) continue;
    sum += convertAmountSync(Math.abs(row.amount), row.currency, 'GBP');
  }
  return { endDate, committedOutflowsGbp: round2(sum) };
}

export function composeAiFinancialSnapshot(
  opts: ComposeAiFinancialSnapshotOpts = {},
): AiFinancialSnapshotResponse {
  const horizonDays = opts.horizonDays ?? 720;
  let commitmentDays = opts.commitmentDays ?? 90;
  if (commitmentDays > horizonDays) {
    commitmentDays = horizonDays;
  }

  const filterEntityId = opts.filterEntityId;
  const loaded = loadForecastInputs({ horizonDays, filterEntityId });
  const pipeline = buildAiPipelineFromLoaded(loaded);
  const liquidity = composeAiLiquidity({
    account: opts.account,
    financialYear: opts.financialYear,
    groupByEntity: opts.groupByEntity,
  });

  const lc = liquidity.liquidityCommitments;
  const cashAfter12 = lc?.cashAfterCommitmentsGbp ?? 0;
  const totalCash = liquidity.liquidityOverview.totalCashGbp;

  const { endDate, committedOutflowsGbp } = sumObligationOutflowsGbpInWindow(
    pipeline,
    loaded.today,
    commitmentDays,
  );
  const cashAfterNear = round2(totalCash - committedOutflowsGbp);

  const assembled = assembleRunway({ forecastInputs: loaded });
  const runway = runwayResponseFromAssembled(assembled, filterEntityId, {
    detail: opts.runwayDetail ?? 'summary',
  });

  const aggregateAccrual = buildAggregateAccrualResponse({ today: liquidity.today });
  const invs = allInvoices().filter(i => i.status === 'issued' || i.status === 'partial');
  const outstanding = outstandingInvoicesGbpSummary(invs, [...allInvoicePayments()]);

  const selectedAccount = validateAccount(opts.account);
  const financialYears = getAvailableFinancialYears();
  const selectedFY = opts.financialYear ?? (financialYears.length > 0 ? financialYears[0] : undefined);
  const fyNormalized = selectedFY !== undefined ? normalizeFinancialYear(selectedFY) : undefined;

  let topNudges: ReturnType<typeof computeBudgetNudges> = [];
  let budgetNudgeCount = 0;
  let insightNote = '';
  if (fyNormalized !== undefined) {
    const expensePipeline = buildExpensePipelineForAccount(selectedAccount, fyNormalized);
    const expenseTxns = getTransactions({
      account: selectedAccount,
      financialYear: selectedFY,
      type: 'expense',
    });
    const expenseTransactions = expenseTxns.map(transactionRowToRaw);
    const budgetRows = listBudgets({ account: selectedAccount });
    const budgetedCategories = new Set(budgetRows.map(b => b.category));
    const nudges = computeBudgetNudges({
      expenseTransactions,
      pipeline: expensePipeline,
      budgetedCategories,
    });
    budgetNudgeCount = nudges.length;
    topNudges = nudges.slice(0, 6);
  } else {
    insightNote = 'No financial year available for budget nudges.';
  }

  const discretionaryNote =
    'cashAfter12MonthCommitmentsGbp uses rolling obligations plus recurring (see liquidityCommitments). ' +
    'cashAfterNearTermWindowGbp subtracts only AI pipeline obligation rows through commitmentWindow.days (recurring near-term is not fully reflected in that sum).';

  const verdict = deriveFinancialVerdict({
    today: loaded.today,
    cashAfter12MonthCommitmentsGbp: cashAfter12,
    holisticGbp: runway.holisticGbp,
    commitmentWindowEndDate: endDate,
  });

  return AiFinancialSnapshotResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
    liquidity,
    commitmentWindow: {
      days: commitmentDays,
      endDate,
      committedOutflowsGbp,
    },
    runway,
    income: {
      outstandingInvoices: outstanding,
      accrual: {
        today: aggregateAccrual.today,
        entityRollupCount: aggregateAccrual.entities.length,
        totals: aggregateAccrual.totals,
      },
    },
    discretionary: {
      totalCashGbp: totalCash,
      cashAfter12MonthCommitmentsGbp: cashAfter12,
      cashAfterNearTermWindowGbp: cashAfterNear,
      nearTermWindowDays: commitmentDays,
      note: discretionaryNote,
    },
    spendVsBudget: {
      financialYear: selectedFY ?? null,
      selectedAccount,
      budgetNudgeCount,
      topNudges,
      insightNote,
    },
    verdict,
  });
}
