import { getDb } from '../../db/connection.js';
import { buildInterCompanyMovementsResponse } from '../../domain/inter-company/movements-response.js';
import { buildConsolidatedWarningsResponse } from '../../domain/warnings/consolidated-feed.js';
import { InterCompanyMovementsResponseSchema } from '../../../shared/api-contracts.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

/** GET /api/warnings/all parity (same composer as legacy bankstatements://ai/warnings resource). */
export function readWarningsConsolidatedFeed(): JsonReadResult {
  try {
    const db = getDb();
    return jsonReadOk(buildConsolidatedWarningsResponse(db));
  } catch (error) {
    console.error('[Warnings read] consolidated error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonReadFail(500, {
      error: `Failed to derive entity-foundation warnings: ${message}`,
    });
  }
}

/** GET /api/warnings/inter-company-movements parity. */
export function readWarningsInterCompanyMovements(): JsonReadResult {
  try {
    const db = getDb();
    const payload = buildInterCompanyMovementsResponse(db);
    const body = InterCompanyMovementsResponseSchema.parse(payload);
    return jsonReadOk(body);
  } catch (error) {
    console.error('[Warnings read] inter-company-movements error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonReadFail(500, { error: `Failed to list inter-company movements: ${message}` });
  }
}
