import type { Obligation } from '../../../shared/api-contracts.js';

/** Forward-looking surfaces (income composition, leverage) use active obligations only. */
export function obligationActiveForProjection(obligation: Obligation): boolean {
  return obligation.active !== false;
}
