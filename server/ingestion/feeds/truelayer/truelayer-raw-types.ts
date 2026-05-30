/**
 * TrueLayer Data API transaction row types — shared by HTTP layer and parsers.
 */

import type { TrueLayerDataResourceSegment } from './truelayer-data-resource.js';

/** One element from a TrueLayer `GET .../transactions` `results` array. */
export interface TrueLayerRawTransaction {
  readonly transaction_id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly amount: number;
  readonly currency: string;
  readonly merchant_name?: string;
  readonly provider_transaction_id?: string;
  readonly meta?: Record<string, unknown>;
  readonly running_balance?: { readonly amount: number; readonly currency: string };
  /** Provider-specific top-level fields (transaction_category, etc.). */
  readonly [key: string]: unknown;
}

export interface TrueLayerMapContext {
  readonly currency: string;
  readonly resourceSegment: TrueLayerDataResourceSegment;
}
