/**
 * Internal feed transaction model — types only.
 *
 * This is the **provider-neutral** shape that every AISP adapter (currently
 * only `enable-banking.ts`) maps its raw responses onto. Each
 * `BankParser.emitFeedTransactionsAsCsv` then turns this back into
 * bank-shaped CSV text that the existing `ingestCsvFile` pipeline accepts.
 *
 * Dependency rule: this module imports **types only** and is the single
 * point parser modules depend on from `feeds/`. No runtime imports here —
 * keeping it type-only makes import cycles impossible.
 */

import type { AccountName } from '../../../shared/api-contracts.js';

/** Sign convention for {@link FeedTransactionRow.amount}. */
export type FeedAmountSign = 'inflow-positive';

/**
 * One transaction as observed at the AISP, in a stable shape that loses
 * no information any current bank parser needs to reconstruct its native
 * CSV row.
 *
 * Fields are intentionally minimal — vendor-specific fields live (and die)
 * inside `enable-banking.ts`. Add a field here only when at least one
 * parser's `emitFeedTransactionsAsCsv` would otherwise have to fabricate
 * data.
 */
export interface FeedTransactionRow {
  /**
   * Booking date as ISO `YYYY-MM-DD`. Banks differ on booking-vs-value-date
   * convention; Enable normalises to booking date when both are present.
   */
  date: string;

  /**
   * Cleaned, human-readable description (merchant name, payment narrative,
   * etc.). Preserved verbatim — no truncation, lowercasing, or stripping —
   * because downstream `transform` and dedup rely on the exact string.
   */
  description: string;

  /**
   * Signed amount in the account's reporting currency.
   *
   * Sign convention is **inflow-positive** regardless of account type:
   *   +100 = money landed in the account (income or refund)
   *   -25  = money left the account (purchase, fee, transfer out)
   *
   * Each `BankParser.emitFeedTransactionsAsCsv` is responsible for flipping
   * the sign back to its CSV's native convention (e.g. credit-card exports
   * report purchases as positive numbers — the parser handles that mapping).
   */
  amount: number;

  /**
   * ISO 4217 currency code (e.g. `GBP`, `AED`). Adapters reject rows whose
   * currency does not match the configured account currency rather than
   * silently coerce.
   */
  currency: string;

  /** Optional running balance after this transaction, when the AISP exposes it. */
  balance?: number;

  /**
   * Stable provider-side transaction id, when available. Useful for adapter-
   * level dedup against the previous page; never persisted in the CSV (the
   * existing row-level dedup keys off date+amount+description+occurrence).
   */
  externalId?: string;

  /** Free-form payment reference / narrative supplied by the AISP. */
  reference?: string;

  /**
   * Counterparty name when separately available (e.g. some banks ship the
   * payer/payee distinct from the description). Optional — most parsers
   * fold this into `description` for emission.
   */
  counterparty?: string;
}

/**
 * Bundle of rows for a single account + window. The window is informational
 * (mirrors what the adapter requested); the rows are authoritative.
 *
 * `account` is part of the model so each parser's `emitFeedTransactionsAsCsv`
 * can include it in CSV columns that name the account (e.g. NatWest's
 * `Account Name` / `Account Number`) without a separate parameter.
 */
export interface InternalFeedTransactions {
  account: AccountName;
  window: {
    /** ISO `YYYY-MM-DD`, inclusive. */
    dateFrom: string;
    /** ISO `YYYY-MM-DD`, inclusive. */
    dateTo: string;
  };
  rows: readonly FeedTransactionRow[];
}
