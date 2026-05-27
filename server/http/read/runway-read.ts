import { z } from 'zod';
import { EntityIdSchema } from '../../../shared/api-contracts.js';
import { assembleRunway } from '../../domain/forecast/index.js';
import { runwayResponseFromAssembled } from '../../domain/forecast/runway-api-response.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

export const HouseholdRunwayQuerySchema = z.object({
  days: z.coerce.number().int().positive().default(720),
  entityId: EntityIdSchema.optional(),
  detail: z.enum(['accounts', 'summary']).default('summary'),
});

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

/** GET /api/runway parity (distinct from MCP `get_ai_runway`). */
export function readHouseholdRunwayFromQuery(query: Record<string, unknown>): JsonReadResult {
  try {
    const parsed = HouseholdRunwayQuerySchema.safeParse(query);
    if (!parsed.success) {
      return jsonReadFail(400, { error: 'invalid-params', issues: parsed.error.issues });
    }
    const { days: horizonDays, entityId: filterEntityId, detail } = parsed.data;
    const assembled = assembleRunway({ horizonDays, filterEntityId });
    const body = runwayResponseFromAssembled(assembled, filterEntityId, { detail });
    return jsonReadOk(body);
  } catch (error) {
    console.error('[Runway read] GET / error:', error);
    return jsonReadFail(500, { error: `Failed to build runway: ${errorMessage(error)}` });
  }
}
