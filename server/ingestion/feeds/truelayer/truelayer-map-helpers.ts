/**
 * Shared TrueLayer → {@link FeedTransactionRow} helpers.
 *
 * Parsers may call {@link defaultTrueLayerRowMapping} or implement bespoke
 * `mapTrueLayerTransaction` when bank-native CSV shape needs different field
 * extraction (e.g. Monzo FPS payee in meta).
 */

import type { FeedTransactionRow } from '../model.js';
import { TrueLayerError } from './truelayer-error.js';
import type { TrueLayerMapContext, TrueLayerRawTransaction } from './truelayer-raw-types.js';

export function bookingIsoDate(timestamp: string): string {
  const t = timestamp.trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  if (m === null || m[1] === undefined) {
    throw new TrueLayerError(
      'invalid-response',
      `TrueLayer transaction timestamp is not ISO-date-prefixed: ${timestamp}`,
    );
  }
  return m[1];
}

export function metaString(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key];
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed !== '' ? trimmed : undefined;
}

export function metaBankTxId(meta: Record<string, unknown> | undefined): string | undefined {
  if (meta === undefined) return undefined;
  const v = meta.bank_transaction_id;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** Bank-native id when TrueLayer exposes it (Monzo `tx_0000…`, etc.). */
export function providerNativeTransactionId(raw: TrueLayerRawTransaction): string | undefined {
  const fromTop = raw.provider_transaction_id?.trim();
  if (fromTop !== undefined && fromTop !== '') return fromTop;
  const meta = raw.meta ?? {};
  return metaString(meta, 'provider_id') ?? metaBankTxId(meta);
}

export function defaultTrueLayerCounterpartyName(raw: TrueLayerRawTransaction): string | undefined {
  const merchant = raw.merchant_name?.trim();
  if (merchant !== undefined && merchant !== '') return merchant;

  const meta = raw.meta ?? {};
  for (const key of ['counter_party_preferred_name', 'debtor_account_name', 'creditor_account_name']) {
    const name = metaString(meta, key);
    if (name !== undefined && name.toLowerCase() !== raw.description.trim().toLowerCase()) {
      return name;
    }
  }
  return undefined;
}

/**
 * Generic TrueLayer row mapping — suitable for Barclays, NatWest, Wise, and
 * card parsers until a bank-specific override is proven necessary by fixtures.
 */
export function defaultTrueLayerRowMapping(
  raw: TrueLayerRawTransaction,
  ctx: TrueLayerMapContext,
): FeedTransactionRow {
  if (raw.currency !== ctx.currency) {
    throw new TrueLayerError(
      'invalid-response',
      `TrueLayer transaction ${raw.transaction_id}: currency ${raw.currency} ≠ expected ${ctx.currency}`,
    );
  }
  let balance: number | undefined;
  if (raw.running_balance !== undefined) {
    if (raw.running_balance.currency !== ctx.currency) {
      throw new TrueLayerError(
        'invalid-response',
        `TrueLayer transaction ${raw.transaction_id}: running_balance currency mismatch`,
      );
    }
    balance = raw.running_balance.amount;
  }
  const date = bookingIsoDate(raw.timestamp);
  const ref = providerNativeTransactionId(raw);
  const counterparty = defaultTrueLayerCounterpartyName(raw);

  /** Card API: purchase positive on wire → negate to inflow-positive internal. */
  const amount = ctx.resourceSegment === 'cards' ? -raw.amount : raw.amount;

  const row: FeedTransactionRow = {
    date,
    description: raw.description,
    amount,
    currency: raw.currency,
    externalId: raw.transaction_id,
  };
  if (counterparty !== undefined) {
    row.counterparty = counterparty;
  }
  if (balance !== undefined) {
    row.balance = balance;
  }
  if (ref !== undefined) {
    row.reference = ref;
  }
  return row;
}
