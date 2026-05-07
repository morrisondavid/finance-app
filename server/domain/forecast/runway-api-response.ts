/**
 * Build the HTTP JSON payload for `GET /api/runway` (and `/api/ai/runway`)
 * from an {@link AssembledRunway}. Shared so AI slices reuse the same
 * `RunwayResponse` shape as the product runway tab.
 */

import type { EntityId, RunwayResponse } from '../../../shared/api-contracts.js';
import { RunwayResponseSchema } from '../../../shared/api-contracts.js';
import { buildExpensesSheetResponse } from '../../../shared/expenses-sheet-build.js';
import { runExpensesOverviewPipeline } from '../../utils/expenses-overview-pipeline.js';
import { buildExpensesSheetInputFromPipeline } from '../../utils/expenses-pipeline-to-sheet.js';
import type { AssembledRunway } from './assemble-runway.js';

export interface RunwayApiResponseOpts {
  readonly detail?: 'accounts' | 'summary';
}

export function runwayResponseFromAssembled(
  assembled: AssembledRunway,
  filterEntityId: EntityId | undefined,
  opts: RunwayApiResponseOpts = {},
): RunwayResponse {
  const detail = opts.detail ?? 'summary';
  const pipeline = runExpensesOverviewPipeline();
  const sheetIn = buildExpensesSheetInputFromPipeline(pipeline);
  const sheet = buildExpensesSheetResponse(sheetIn);

  const scopeNote =
    filterEntityId === undefined
      ? 'Insight uses rolling UK-centric recurring detection; bills vs QoL split is strongest for GBP/personal lines. Holistic runways merge all accounts in each currency.'
      : `Insight uses rolling UK-centric recurring detection. Runway is scoped to entity ${filterEntityId} accounts only.`;

  return RunwayResponseSchema.parse({
    today: assembled.today,
    horizonDays: assembled.horizonDays,
    household: assembled.household,
    holisticGbp: assembled.holisticGbp,
    insight: sheet.insight,
    insightNote: scopeNote,
    stress: {
      fullRecurring: {
        entities: assembled.fullRecurring.result.entities,
        accounts: detail === 'accounts' ? assembled.fullRecurring.result.accounts : undefined,
      },
      mandatoryRecurring: {
        entities: assembled.mandatoryRecurring.result.entities,
        accounts: detail === 'accounts' ? assembled.mandatoryRecurring.result.accounts : undefined,
      },
    },
  });
}
