/**
 * POST `/api/warnings/inter-company-movements/classify` — Express + MCP.
 */

import {
  InterCompanyClassifyRequestSchema,
  InterCompanyMovementsResponseSchema,
} from '../../../shared/api-contracts.js';
import { getDb } from '../../db/connection.js';
import { classifyInterCompanyPair } from '../../domain/transaction-overrides/classify-pair.js';
import { buildInterCompanyMovementsResponse } from '../../domain/inter-company/movements-response.js';
import type { JsonMutationResult } from './types.js';

export function mutateWarningsResolveInterCompanyClassifications(body: unknown): JsonMutationResult {
  const parsed = InterCompanyClassifyRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: 400,
      body: {
        error: `Invalid classify request: ${issue.path.join('.') || '(root)'} — ${issue.message}`,
      },
    };
  }

  try {
    const db = getDb();
    const result = classifyInterCompanyPair(db, {
      expenseHash: parsed.data.expenseHash,
      incomeHash: parsed.data.incomeHash,
      category: parsed.data.category,
      notes: parsed.data.notes ?? null,
    });
    if (!result.ok) {
      return { status: result.status, body: { error: result.error } };
    }

    const payload = InterCompanyMovementsResponseSchema.parse(buildInterCompanyMovementsResponse(db));
    return { status: 200, body: payload };
  } catch (error) {
    console.error('[Warnings] classify error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { status: 500, body: { error: `Failed to classify inter-company pair: ${message}` } };
  }
}
