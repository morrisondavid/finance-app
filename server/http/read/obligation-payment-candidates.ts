import { findObligationPaymentCandidates } from '../../domain/obligations/payment-candidates.js';
import {
  ObligationPaymentCandidatesQuerySchema,
  type ObligationPaymentCandidatesResponse,
} from '../../../shared/api-contracts.js';
import { flattenExpressQuery } from '../../utils/flatten-express-query.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

/** GET /api/obligations/:id/payment-candidates */
export function readObligationPaymentCandidates(
  obligationId: string,
  queryUnknown: Record<string, unknown> = {},
): JsonReadResult {
  try {
    const parsed = ObligationPaymentCandidatesQuerySchema.safeParse(flattenExpressQuery(queryUnknown));
    if (!parsed.success) {
      return jsonReadFail(400, { error: 'Invalid request', details: parsed.error.issues });
    }

    const candidates = findObligationPaymentCandidates(obligationId, parsed.data);
    if (candidates === null) {
      return jsonReadFail(404, { error: 'Obligation not found' });
    }
    const payload: ObligationPaymentCandidatesResponse = { candidates };
    return jsonReadOk(payload);
  } catch {
    console.error('[Obligations read] GET /:id/payment-candidates error');
    return jsonReadFail(500, { error: 'Failed to fetch payment candidates' });
  }
}
