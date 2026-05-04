/**
 * Composite key for §1.9 debt strategy + forecast: `currency::scope`.
 * Alias documents intent; value format matches {@link bucketKey}.
 */

import type { CurrencyCode } from '../../../shared/api-contracts.js';
import type { PlanScope } from './schema.js';
import { bucketKey } from './auto-suggest-plans.js';

export type StrategyBucketKey = string;

export { bucketKey };

export function parseStrategyBucketKey(key: StrategyBucketKey): {
  currency: CurrencyCode;
  scope: PlanScope;
} {
  const idx = key.indexOf('::');
  const currency = key.slice(0, idx) as CurrencyCode;
  const scope = key.slice(idx + 2) as PlanScope;
  return { currency, scope };
}
