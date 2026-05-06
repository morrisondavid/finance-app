/**
 * GET /api/runway — worst-case household stress (no new contract income) with
 * GBP + AED holistic headlines and entity drill-down in `stress` blocks.
 *
 * Thin route. Loads + computes via
 * [`server/domain/forecast/assemble-runway.ts`](../domain/forecast/assemble-runway.ts);
 * the §1.8 warnings spine reuses the same assembler.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  EntityIdSchema,
  RunwayResponseSchema,
} from '../../shared/api-contracts.js';
import { buildExpensesSheetResponse } from '../../shared/expenses-sheet-build.js';
import { runExpensesOverviewPipeline } from '../utils/expenses-overview-pipeline.js';
import { buildExpensesSheetInputFromPipeline } from '../utils/expenses-pipeline-to-sheet.js';
import { assembleRunway } from '../domain/forecast/index.js';

const router = Router();

const QuerySchema = z.object({
  days: z.coerce.number().int().positive().default(720),
  entityId: EntityIdSchema.optional(),
  /** When `accounts`, per-account series are included in `stress` (larger JSON). */
  detail: z.enum(['accounts', 'summary']).default('summary'),
});

router.get('/', (req: Request, res: Response) => {
  try {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }

    const { days: horizonDays, entityId: filterEntityId, detail } = parsed.data;
    const assembled = assembleRunway({ horizonDays, filterEntityId });

    // The expenses-insight panel is a separate concern — runway leaves the
    // pipeline running once already (inside `assembleRunway`), so this is a
    // second cheap pass through the cached result.
    const pipeline = runExpensesOverviewPipeline();
    const sheetIn = buildExpensesSheetInputFromPipeline(pipeline);
    const sheet = buildExpensesSheetResponse(sheetIn);

    const scopeNote =
      filterEntityId === undefined
        ? 'Insight uses rolling UK-centric recurring detection; bills vs QoL split is strongest for GBP/personal lines. Holistic runways merge all accounts in each currency.'
        : `Insight uses rolling UK-centric recurring detection. Runway is scoped to entity ${filterEntityId} accounts only.`;

    const body = RunwayResponseSchema.parse({
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
    res.json(body);
  } catch (error) {
    console.error('[Runway] GET / error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build runway: ${message}` });
  }
});

export default router;
