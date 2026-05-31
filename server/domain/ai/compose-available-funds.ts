/**
 * GET /api/ai/available-funds — reuses liquidity overview, expected receipts, AI pipeline obligations.
 */

import type { AiAvailableFundsResponse, EntityId } from '../../../shared/api-contracts.js';
import { AiAvailableFundsResponseSchema } from '../../../shared/api-contracts.js';
import { shiftIsoDate } from '../../../shared/iso-date.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import { getAllAccountBalances } from '../../db/repositories/balance.js';
import { buildLiquidityOverview } from '../accounts/liquidity-overview.js';
import { buildExpectedReceipts } from '../contracts/expected-receipts.js';
import { loadForecastInputs } from '../forecast/load-inputs.js';
import { round2 } from '../../utils/math.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';
import { buildAiPipelineFromLoaded } from './compose-pipeline.js';

export interface ComposeAiAvailableFundsOpts {
  readonly horizonDays?: number;
  readonly filterEntityId?: EntityId;
}

export function composeAiAvailableFunds(
  opts: ComposeAiAvailableFundsOpts = {},
): AiAvailableFundsResponse {
  const horizonDays = opts.horizonDays ?? 720;
  const loaded = loadForecastInputs({
    horizonDays,
    filterEntityId: opts.filterEntityId,
  });
  const liquidity = buildLiquidityOverview(getAllAccountBalances());
  const receipts = buildExpectedReceipts({
    forecastInputs: loaded,
    projectToContractEnd: true,
  });

  const futureIncome = receipts.receipts.filter(r => r.expectedDate >= loaded.today);
  let confirmedFutureIncomeGbp = 0;
  for (const r of futureIncome) {
    confirmedFutureIncomeGbp += convertAmountSync(r.amount, r.currency, 'GBP');
  }
  confirmedFutureIncomeGbp = round2(confirmedFutureIncomeGbp);

  const futureDates = futureIncome.map(r => r.expectedDate);
  const nextIncomeDate = futureDates.length > 0
    ? futureDates.reduce((a, b) => (a <= b ? a : b))
    : null;
  const lastConfirmedIncomeDate = futureDates.length > 0
    ? futureDates.reduce((a, b) => (a >= b ? a : b))
    : null;

  const pipeline = buildAiPipelineFromLoaded(loaded);
  const commitmentEnd = shiftIsoDate(loaded.today, horizonDays);
  let committedOutflowsGbp = 0;
  for (const row of pipeline.rows) {
    if (row.kind !== 'obligation') continue;
    if (row.date < loaded.today || row.date > commitmentEnd) continue;
    committedOutflowsGbp += convertAmountSync(Math.abs(row.amount), row.currency, 'GBP');
  }
  committedOutflowsGbp = round2(committedOutflowsGbp);

  const availableNowGbp = liquidity.totalCashGbp;
  const projectedAvailableGbp = round2(
    availableNowGbp + confirmedFutureIncomeGbp - committedOutflowsGbp,
  );

  return AiAvailableFundsResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
    horizonDays,
    availableNowGbp,
    confirmedFutureIncomeGbp,
    futureIncome,
    nextIncomeDate,
    lastConfirmedIncomeDate,
    committedOutflowsGbp,
    projectedAvailableGbp,
  });
}
