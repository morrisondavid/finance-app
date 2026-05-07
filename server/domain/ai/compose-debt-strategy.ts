import { DebtStrategyStateResponseSchema } from '../../../shared/api-contracts.js';
import { assembleDebtStrategy } from '../debt-strategy/assemble.js';
import { debtStrategyBundleToResponseJson } from '../debt-strategy/bundle-to-response-json.js';

export function composeAiDebtStrategyState() {
  const bundle = assembleDebtStrategy({});
  return DebtStrategyStateResponseSchema.parse(debtStrategyBundleToResponseJson(bundle));
}
