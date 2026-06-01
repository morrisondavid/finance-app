import { z } from 'zod';
import {
  ForecastResponseSchema,
  EntityIdSchema,
} from '../../../shared/api-contracts.js';
import {
  assembleForecastEvents,
  buildForecast,
} from '../../domain/forecast/index.js';
import { loadForecastInputs } from '../../domain/forecast/load-inputs.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

export const ForecastHttpQuerySchema = z.object({
  days: z.coerce.number().int().positive().default(90),
  entityId: EntityIdSchema.optional(),
});

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

/** GET /api/forecast parity. */
export function readForecastFromQuery(query: Record<string, unknown>): JsonReadResult {
  try {
    const parsed = ForecastHttpQuerySchema.safeParse(query);
    if (!parsed.success) {
      return jsonReadFail(400, { error: 'invalid-params', issues: parsed.error.issues });
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
      accrualWindowStartByContractId: inputs.accrualWindowStartByContractId,
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
    return jsonReadOk(body);
  } catch (error) {
    console.error('[Forecast read] GET / error:', error);
    return jsonReadFail(500, { error: `Failed to build forecast: ${errorMessage(error)}` });
  }
}
