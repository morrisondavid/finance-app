/**
 * Canned TrueLayer Data API transaction payloads for feed adapter tests.
 *
 * Models **`GET /data/v1/accounts/{account_id}/transactions`** and
 * **`GET /data/v1/cards/{card_id}/transactions`** responses (same envelope shape).
 */

import type { FeedTransactionRow } from '../model.js';

/** Shape of one row in a TrueLayer transactions `results` array. */
export interface TrueLayerRawTransaction {
  readonly transaction_id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly amount: number;
  readonly currency: string;
  readonly merchant_name?: string;
  readonly meta?: Record<string, unknown>;
  readonly running_balance?: { readonly amount: number; readonly currency: string };
}

export const TRUE_LAYER_ACCOUNT_ID = 'tl-acc-test-1';
export const TRUE_LAYER_CARD_ID = 'tl-card-test-1';

export const DATE_FROM = '2026-04-15';
export const DATE_TO = '2026-04-16';

/** Debit purchase with distinct merchant name and bank reference in meta. */
export const canonicalTrueLayerDebitPurchase: TrueLayerRawTransaction = {
  transaction_id: 'ext-1',
  timestamp: '2026-04-15T12:00:00Z',
  description: 'COFFEE SHOP',
  amount: -3.5,
  currency: 'GBP',
  merchant_name: 'Coffee Shop Ltd',
  meta: { bank_transaction_id: 'ref-1' },
};

/** Credit inflow with running balance. */
export const canonicalTrueLayerCreditInflow: TrueLayerRawTransaction = {
  transaction_id: 'ext-2',
  timestamp: '2026-04-16T09:00:00Z',
  description: 'SALARY',
  amount: 1200,
  currency: 'GBP',
  meta: { bank_transaction_id: 'ref-2' },
  running_balance: { amount: 5000, currency: 'GBP' },
};

/** Merchant equals description — mapper must not append a duplicate suffix. */
export const trueLayerSameMerchantAndDescription: TrueLayerRawTransaction = {
  transaction_id: 'ext-same',
  timestamp: '2026-04-15T08:00:00Z',
  description: 'COFFEE SHOP',
  amount: -3.5,
  currency: 'GBP',
  merchant_name: 'COFFEE SHOP',
};

/** Rental payee with distinct merchant_name — Monzo Name/Description split regression. */
export const trueLayerStoneshawRental: TrueLayerRawTransaction = {
  transaction_id: 'tl-stoneshaw-ext',
  timestamp: '2026-04-15T10:00:00Z',
  description: '78 HUNTERS SQ',
  amount: 850,
  currency: 'GBP',
  merchant_name: 'Stoneshaw',
  meta: { bank_transaction_id: 'monzo-tx-stoneshaw' },
};

/** Expected row after {@link mapTrueLayerTransactionRow} for {@link trueLayerStoneshawRental}. */
export const expectedStoneshawMappedFeedRow: FeedTransactionRow = {
  date: '2026-04-15',
  description: '78 HUNTERS SQ',
  amount: 850,
  currency: 'GBP',
  externalId: 'tl-stoneshaw-ext',
  reference: 'monzo-tx-stoneshaw',
  counterparty: 'Stoneshaw',
};

/** Native Monzo export row shape for {@link trueLayerStoneshawRental}. */
export const nativeMonzoStoneshawCsvRow: Readonly<Record<string, string>> = {
  'Transaction ID': 'monzo-tx-stoneshaw',
  Date: '15/04/2026',
  Name: 'Stoneshaw',
  Description: '78 HUNTERS SQ',
  Amount: '850.00',
};

export const trueLayerOutsideWindow: TrueLayerRawTransaction = {
  transaction_id: 'ext-out',
  timestamp: '2026-04-20T12:00:00Z',
  description: 'LATE',
  amount: -1,
  currency: 'GBP',
};

export const canonicalTrueLayerRawTransactions: readonly TrueLayerRawTransaction[] = [
  canonicalTrueLayerDebitPurchase,
  canonicalTrueLayerCreditInflow,
];

/** Card API: purchase is positive on the wire; mapper negates to inflow-positive internal. */
export const canonicalTrueLayerCardDebitPurchase: TrueLayerRawTransaction = {
  ...canonicalTrueLayerDebitPurchase,
  amount: 3.5,
};

/** Card API: payment/refund is negative on the wire; mapper negates to positive internal inflow. */
export const canonicalTrueLayerCardCreditInflow: TrueLayerRawTransaction = {
  ...canonicalTrueLayerCreditInflow,
  amount: -1200,
};

export const canonicalTrueLayerCardRawTransactions: readonly TrueLayerRawTransaction[] = [
  canonicalTrueLayerCardDebitPurchase,
  canonicalTrueLayerCardCreditInflow,
];

/**
 * Expected {@link FeedTransactionRow} values after `mapTransactionRow` in
 * {@link fetchTrueLayerTransactions} for {@link canonicalTrueLayerRawTransactions}.
 */
export const expectedMappedFeedTransactionRows: readonly FeedTransactionRow[] = [
  {
    date: '2026-04-15',
    description: 'COFFEE SHOP',
    amount: -3.5,
    currency: 'GBP',
    externalId: 'ext-1',
    reference: 'ref-1',
    counterparty: 'Coffee Shop Ltd',
  },
  {
    date: '2026-04-16',
    description: 'SALARY',
    amount: 1200,
    currency: 'GBP',
    externalId: 'ext-2',
    reference: 'ref-2',
    balance: 5000,
  },
];

export interface TrueLayerTransactionsEnvelopeExtras {
  readonly next_uri?: string;
}

/** Wrap raw TrueLayer transaction objects in the API `{ results: [...] }` envelope. */
export function makeTrueLayerTransactionsEnvelope(
  rows: readonly TrueLayerRawTransaction[],
  extras?: TrueLayerTransactionsEnvelopeExtras,
): { results: TrueLayerRawTransaction[]; next_uri?: string } {
  const envelope: { results: TrueLayerRawTransaction[]; next_uri?: string } = {
    results: [...rows],
  };
  if (extras?.next_uri !== undefined) {
    envelope.next_uri = extras.next_uri;
  }
  return envelope;
}
