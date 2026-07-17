/**
 * §2.2 Financial Safety — composed score from existing AI primitives.
 */

import type { AiFinancialSafetyResponse } from '../../../shared/api-contracts.js';
import { AiFinancialSafetyResponseSchema } from '../../../shared/api-contracts.js';
import { computeFinancialSafety } from '../../../shared/financial-safety/compute.js';
import type { FinancialSafetyInput } from '../../../shared/financial-safety/types.js';
import { getDb } from '../../db/connection.js';
import { assembleDebtStrategy, type AssembledDebtStrategy } from '../debt-strategy/assemble.js';
import { loadForecastInputs } from '../forecast/load-inputs.js';
import { buildConsolidatedWarningsResponseWithReadContext } from '../../http/read-context.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';
import {
  composeAiFinancialSnapshot,
  type ComposeAiFinancialSnapshotOpts,
} from './compose-financial-snapshot.js';
import { composeAiIncomeComposition } from './compose-income-composition.js';

export type ComposeAiFinancialSafetyOpts = ComposeAiFinancialSnapshotOpts;

function minDebtAvailableHeadroomRatio(bundle: AssembledDebtStrategy): number | null {
  let minR: number | null = null;
  for (const b of bundle.headroomByBucket.values()) {
    if (b.totalHeadroom <= 1e-9) continue;
    const r = Math.min(1, Math.max(0, b.availableHeadroom / b.totalHeadroom));
    minR = minR === null ? r : Math.min(minR, r);
  }
  return minR;
}

export function composeAiFinancialSafety(opts: ComposeAiFinancialSafetyOpts = {}): AiFinancialSafetyResponse {
  const loaded =
    opts.forecastInputs ??
    loadForecastInputs({
      horizonDays: opts.horizonDays,
      filterEntityId: opts.filterEntityId,
      today: opts.today,
    });
  const snapshot = composeAiFinancialSnapshot({ ...opts, forecastInputs: loaded });
  const income = composeAiIncomeComposition();
  const warnings = buildConsolidatedWarningsResponseWithReadContext(getDb(), {
    applySnoozeListingFilter: false,
  });
  const debtBundle = assembleDebtStrategy({});

  const lc = snapshot.liquidity.liquidityCommitments;
  const totalCommittedGbp = lc?.totalCommittedGbp ?? 0;
  const cashAfterCommitmentsGbp =
    lc?.cashAfterCommitmentsGbp ?? snapshot.discretionary.cashAfter12MonthCommitmentsGbp;

  const topShare = income.household.GBP?.clientConcentration.ratio ?? null;

  const debtR = minDebtAvailableHeadroomRatio(debtBundle);

  const warningInputs = warnings.warnings.map(w => ({
    id: w.id,
    code: w.code,
    severity: w.severity,
    ...(w.fingerprint !== undefined ? { fingerprint: w.fingerprint } : {}),
  }));

  const input: FinancialSafetyInput = {
    totalCashGbp: snapshot.liquidity.liquidityOverview.totalCashGbp,
    totalCommittedGbp,
    cashAfterCommitmentsGbp,
    runwayMonthsFullRecurring: snapshot.runway.holisticGbp.runwayMonthsFullRecurring,
    verdictKind: snapshot.verdict.kind,
    topClientShareOfActiveMonthly: topShare,
    outstandingInvoicesGbp: snapshot.income.outstandingInvoices.totalOutstandingGbp,
    earnedButNotCollectedGbp: snapshot.income.earnedButNotCollectedGbp,
    budgetNudgeCount: snapshot.spendVsBudget.budgetNudgeCount,
    debtMinAvailableHeadroomRatio: debtR,
    warnings: warningInputs,
  };

  const computed = computeFinancialSafety(input);

  return AiFinancialSafetyResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
    inputsRef: {
      financialSnapshotGeneratedAt: snapshot.generatedAt,
    },
    score: computed.score,
    formulaVersion: computed.formulaVersion,
    pillars: [...computed.pillars],
    warningAdjustment: computed.warningAdjustment,
    baseScoreBeforeWarnings: computed.baseScoreBeforeWarnings,
  });
}
