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
} from '../../shared/api-contracts.js';
import { assembleRunway } from '../domain/forecast/index.js';
import { runwayResponseFromAssembled } from '../domain/forecast/runway-api-response.js';

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
    const body = runwayResponseFromAssembled(assembled, filterEntityId, { detail });
    res.json(body);
  } catch (error) {
    console.error('[Runway] GET / error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build runway: ${message}` });
  }
});

export default router;
