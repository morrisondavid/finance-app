/**
 * GET `/api/debts` read model — Express + MCP (`debts_list`).
 */

import { z } from 'zod';
import { getAllDebtSummaries } from '../../db/repositories/debts.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

const DebtsListQuerySchema = z.object({
  includeArchived: z.union([z.boolean(), z.enum(['true', 'false', '1'])]).optional(),
});

export function readDebtsListFromQuery(query: Record<string, unknown>): JsonReadResult {
  try {
    const parsed = DebtsListQuerySchema.safeParse(query);
    if (!parsed.success) {
      return jsonReadFail(400, { error: 'Invalid query', details: parsed.error.issues });
    }
    const includeArchived =
      parsed.data.includeArchived === true ||
      parsed.data.includeArchived === 'true' ||
      parsed.data.includeArchived === '1';
    const rows = getAllDebtSummaries({ includeArchived });
    return jsonReadOk(rows);
  } catch (error) {
    console.error('[Debts read] list error:', error);
    return jsonReadFail(500, { error: 'Failed to list debts' });
  }
}
