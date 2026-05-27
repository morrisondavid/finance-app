/**
 * PUT `/api/expenses/simulation-exclusions` — Express + MCP (**persists exclusions**).
 */

import { SimulationExclusionsPutBodySchema } from '../../../shared/api-contracts.js';
import {
  getFixedExpenseSimulationExclusions,
  replaceFixedExpenseSimulationExclusions,
} from '../../db/repositories/fixed-expense-simulation-exclusions.js';
import type { JsonMutationResult } from './types.js';

export function mutateSimulationExclusionsReplace(body: unknown): JsonMutationResult {
  try {
    const parsed = SimulationExclusionsPutBodySchema.safeParse(body);
    if (!parsed.success) {
      return { status: 400, body: { error: 'Invalid body: expected { lineKeys: string[] }' } };
    }
    replaceFixedExpenseSimulationExclusions(parsed.data.lineKeys);
    return { status: 200, body: { lineKeys: getFixedExpenseSimulationExclusions() } };
  } catch (error) {
    console.error('[Expenses mutation] simulation-exclusions error:', error);
    return { status: 500, body: { error: 'Failed to save simulation exclusions' } };
  }
}
