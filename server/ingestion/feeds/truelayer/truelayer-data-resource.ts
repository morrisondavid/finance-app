/**
 * TrueLayer Data API resource segment for transaction fetch and OAuth discovery.
 */

import type { AccountName } from '../../../../shared/api-contracts.js';
import { isCreditCard } from '../../../domain/accounts/index.js';

export type TrueLayerDataResourceSegment = 'accounts' | 'cards';

/** Credit-card ledger accounts use `/data/v1/cards`; others use `/data/v1/accounts`. */
export function trueLayerDataResourceSegment(account: AccountName): TrueLayerDataResourceSegment {
  return isCreditCard(account) ? 'cards' : 'accounts';
}
