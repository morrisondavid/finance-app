/**
 * GET `/api/debt-strategy/state` read — Express + MCP (`debt_strategy_get_state`).
 */

import { DebtStrategyStateResponseSchema } from '../../../shared/api-contracts.js';
import { assembleDebtStrategy } from '../../domain/debt-strategy/assemble.js';
import { debtStrategyBundleToResponseJson } from '../../domain/debt-strategy/bundle-to-response-json.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

export function readDebtStrategyStateBundle(): JsonReadResult {
  try {
    const bundle = assembleDebtStrategy({});
    const unchecked = debtStrategyBundleToResponseJson(bundle);
    return jsonReadOk(DebtStrategyStateResponseSchema.parse(unchecked));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return jsonReadFail(500, { error: 'state-failed', message });
  }
}
