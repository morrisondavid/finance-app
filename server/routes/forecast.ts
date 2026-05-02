/**
 * /api/forecast — cash-flow projection endpoint (§1.5).
 *
 * Route map:
 *   GET /api/forecast?days=90&entityId=autonize-it-ltd
 *     — daily-resolution balance projection per account and entity.
 *       `days` defaults to 90; `entityId` is optional (omit for all).
 *
 * Thin route: delegates loader I/O to the canonical
 * `loadForecastInputs()`, feeds the result through
 * `assembleForecastEvents` with the live flags
 * (`includeAccrual: true, includeInvoiceReceipts: true`) and the
 * pure forecast engine, then validates the response through Zod.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  EntityIdSchema,
  ForecastResponseSchema,
} from '../../shared/api-contracts.js';

import {
  assembleForecastEvents,
  buildForecast,
} from '../domain/forecast/index.js';
import { loadForecastInputs } from '../domain/forecast/load-inputs.js';

const router = Router();

const QuerySchema = z.object({
  days: z.coerce.number().int().positive().default(90),
  entityId: EntityIdSchema.optional(),
});

router.get('/', (req: Request, res: Response) => {
  try {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }

    const { days: horizonDays, entityId: filterEntityId } = parsed.data;
    const inputs = loadForecastInputs({ horizonDays, filterEntityId });

    const allEvents = assembleForecastEvents({
      today: inputs.today,
      horizon: inputs.horizon,
      defaultAccountByType: inputs.defaultAccountByType,
      currencyByAccount: inputs.currencyByAccount,
      accountsByEntity: inputs.accountsByEntity,
      obligations: inputs.obligations,
      pipeline: inputs.pipeline,
      upcomingBuckets: inputs.upcomingBuckets,
      unpaidInvoices: inputs.unpaidInvoices,
      contracts: inputs.contracts,
      leaveRows: inputs.leaveRows,
      publicHolidayDatesByEntity: inputs.publicHolidayDatesByEntity,
      includeInvoiceReceipts: true,
      includeAccrual: true,
    });

    const result = buildForecast({
      today: inputs.today,
      horizonDays,
      startingBalances: inputs.startingBalances,
      events: allEvents,
    });

    const body = ForecastResponseSchema.parse(result);
    res.json(body);
  } catch (error) {
    console.error('[Forecast] GET / error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build forecast: ${message}` });
  }
});

export default router;
