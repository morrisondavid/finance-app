/**
 * Payment-outside-contract-window warnings (Roadmap 1.2.C).
 *
 * One per business-account income transaction that:
 *   - is recognisably from a known client (narrative-match hit), AND
 *   - falls outside every active contract window for the (client,
 *     receiving entity) pair.
 *
 * This is the early-warning cousin of Phase 4's reconciler: the
 * reconciler will link each deposit to a specific invoice; until then,
 * this derivation catches the frequent scenario "client paid me but
 * their contract ended last month — I owe them a renewal or their
 * finance team paid the wrong invoice".
 *
 * Pure w.r.t. its inputs so {@link collectPaymentOutsideContractWindow}
 * is the cold-path helper the route layer calls; the DB read happens in
 * {@link derivePaymentOutsideContractWindowWarnings} which hydrates it
 * from `transactions.csv` via better-sqlite3.
 */

import type Database from 'better-sqlite3';
import type {
  EntityFoundationWarning,
  EntityId,
  Transaction,
} from '../../../shared/api-contracts.js';
import {
  matchPayerToContract,
  type PayerMatchResult,
} from '../contracts/payer-match.js';
import {
  businessAccounts,
  getEntityIdForAccount,
  isValidAccountName,
} from '../accounts/queries.js';
import { shiftIsoDate, toIsoDate } from '../../../shared/iso-date.js';

/**
 * Lookback window for the DB query. 180 days covers the renewal /
 * extension cadence we see in practice without flooding the warnings
 * tab with ancient deposits. The caller is always free to override.
 */
export const DEFAULT_LOOKBACK_DAYS = 180;

export interface CollectPaymentOutsideWindowInput {
  /** Every candidate income transaction to evaluate. */
  readonly transactions: readonly Transaction[];
  /**
   * Map from `Transaction.account` → the issuing entity that owns the
   * account. Accounts not keyed here are skipped (safe default for
   * personal accounts which legally cannot receive business income).
   */
  readonly accountEntityId: (account: string) => EntityId | null;
}

/**
 * Pure core: walk the supplied transactions, call
 * `matchPayerToContract`, and produce one warning per
 * `outside-contract-window` hit. Kept separate from the DB read so
 * tests can pump in deterministic fixtures.
 */
export function collectPaymentOutsideContractWindow(
  input: CollectPaymentOutsideWindowInput,
): readonly EntityFoundationWarning[] {
  const out: EntityFoundationWarning[] = [];
  const seen = new Set<string>();

  for (const tx of input.transactions) {
    if (tx.type !== 'income') continue;

    const entityId = input.accountEntityId(tx.account);
    if (entityId === null) continue;

    const match: PayerMatchResult = matchPayerToContract({
      transaction: tx,
      accountEntityId: entityId,
    });
    if (match.kind !== 'outside-contract-window') continue;

    // Dedupe by (client, date, account, amount) so re-importing the
    // same CSV doesn't multiply warnings.
    const key = `${match.client.id}|${tx.date}|${tx.account}|${tx.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(buildWarning(match, tx));
  }

  return out;
}

/**
 * DB-backed surface for the route layer. Loads the last
 * {@link DEFAULT_LOOKBACK_DAYS} of income transactions across every
 * business account and hands them to the pure core above.
 */
export function derivePaymentOutsideContractWindowWarnings(
  db: Database.Database,
  today: Date,
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS,
): readonly EntityFoundationWarning[] {
  const endIso = toIsoDate(today);
  const startIso = shiftIsoDate(endIso, -lookbackDays);
  const accounts = businessAccounts();
  if (accounts.length === 0) return [];

  const placeholders = accounts.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT date, description, amount, account, type
         FROM transactions
         WHERE type = 'income'
           AND account IN (${placeholders})
           AND date >= ? AND date <= ?
         ORDER BY date ASC`,
    )
    .all(...accounts, startIso, endIso) as readonly Transaction[];

  return collectPaymentOutsideContractWindow({
    transactions: rows,
    accountEntityId: acc =>
      isValidAccountName(acc) ? getEntityIdForAccount(acc) : null,
  });
}

function buildWarning(
  match: Extract<PayerMatchResult, { kind: 'outside-contract-window' }>,
  tx: Transaction,
): EntityFoundationWarning {
  const client = match.client;
  const contract = match.nearestContract;
  const endedOn = contract.end_date ?? contract.start_date;

  const detail = tx.date < contract.start_date
    ? `${formatAccount(tx.account)} deposit from ${client.trading_name} on ${tx.date} (${formatAmount(tx.amount, tx.account)}) arrived before contract ${contract.reference} started on ${contract.start_date}.`
    : `${formatAccount(tx.account)} deposit from ${client.trading_name} on ${tx.date} (${formatAmount(tx.amount, tx.account)}) falls outside every active contract window. Nearest: ${contract.id} ended ${endedOn}.`;

  const recommended_action =
    tx.date < contract.start_date
      ? `Confirm the deposit is for ${contract.reference} and that its start date is correctly set in clients/contracts.csv.`
      : `Confirm whether a renewal contract starts on or after ${tx.date} and add it to clients/contracts.csv, or mark this deposit as a residual payment for ${contract.id}.`;

  return {
    id: `entity-foundation.payment-outside-contract-window.${client.id}.${tx.date}.${tx.account}.${tx.amount}`,
    code: 'payment-outside-contract-window',
    severity: 'warn',
    title: `Payment from ${client.trading_name} outside contract window`,
    detail,
    recommended_action,
    sources: [
      `transaction:${tx.account}:${tx.date}`,
      `client:${client.id}`,
      `contract:${contract.id}`,
    ],
  };
}

function formatAmount(amount: number, account: string): string {
  // Assume GBP for UK Ltd accounts, AED for FZCO accounts. The account
  // label is the disambiguator in the message either way.
  const isFzco = /fzco|emirates|wio|rakbank/i.test(account);
  const currency = isFzco ? 'AED' : 'GBP';
  const formatted = new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Math.abs(amount));
  return `${currency} ${formatted}`;
}

function formatAccount(account: string): string {
  return account
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
