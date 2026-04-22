/**
 * Inter-company pair detection (Roadmap 1.1 / Phase 8).
 *
 * Extracts the FX-aware, date-tolerant amount-matching heuristic
 * that `detectTransfers()` uses for within-entity transfer pairing
 * and applies it across entity boundaries instead. The result is
 * the list of (UK Ltd expense, UAE FZCO income) — and vice-versa —
 * candidate pairs that the user must confirm via the Warnings tab.
 *
 * Design note: we deliberately do NOT mutate the DB from here.
 * `detectTransfers()` nets within-entity pairs by flipping their
 * `type` to `transfer`; inter-company pairs stay as independent
 * income / expense rows so the audit trail is preserved, and the
 * Phase 8 classification override mechanism (see
 * `server/domain/transaction-overrides`) is what "suppresses" them
 * from double-counting.
 */

import type Database from 'better-sqlite3';
import {
  CROSS_CURRENCY_TOLERANCE,
  TRANSFER_DATE_TOLERANCE_DAYS,
} from '../../config/transfer-patterns.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import {
  getAccountConfig,
  isValidAccountName,
  getEntityIdForAccount,
  isBusinessAccount,
  type CurrencyCode,
  type EntityId,
} from '../../types.js';

export interface PairCandidate {
  id: number;
  hash: string;
  date: string;
  account: string;
  amount: number;
  description: string;
}

export interface InterCompanyPair {
  expense: PairCandidate & { entityId: EntityId | null };
  income: PairCandidate & { entityId: EntityId | null };
}

/**
 * Pure predicate: do an expense and an income candidate sit close
 * enough on (amount × currency × date) to be considered a
 * potentially paired movement? Used by both `detectTransfers()` (for
 * within-entity pairing) and `findInterCompanyPairs()` (for
 * inter-company detection) so the two code paths can never drift out
 * of calibration.
 *
 * Accepts the currency of each side so callers with a DB row can
 * pass it in without incurring an extra ACCOUNT_CONFIG lookup; a
 * convenience wrapper {@link doAmountsAndDatesMatchForAccounts}
 * resolves currency from account id for callers that prefer that.
 */
export function doAmountsAndDatesMatch(args: {
  expenseAmount: number;
  expenseCurrency: CurrencyCode;
  expenseDate: string;
  incomeAmount: number;
  incomeCurrency: CurrencyCode;
  incomeDate: string;
}): boolean {
  const expenseAbs = Math.abs(args.expenseAmount);
  const incomeAbs = Math.abs(args.incomeAmount);
  const crossCurrency = args.expenseCurrency !== args.incomeCurrency;

  if (crossCurrency) {
    const converted = convertAmountSync(
      expenseAbs,
      args.expenseCurrency,
      args.incomeCurrency,
    );
    const diff = Math.abs(incomeAbs - converted);
    if (diff / Math.max(incomeAbs, 1) > CROSS_CURRENCY_TOLERANCE) return false;
  } else {
    if (Math.abs(incomeAbs - expenseAbs) > 0.01) return false;
  }

  const daysDiff =
    Math.abs(new Date(args.incomeDate).getTime() - new Date(args.expenseDate).getTime()) /
    (1000 * 60 * 60 * 24);
  return daysDiff <= TRANSFER_DATE_TOLERANCE_DAYS;
}

/**
 * Currency-aware variant keyed by account id. Accepts arbitrary
 * strings (DB rows carry `account` as a plain column) and resolves
 * each side's currency via `ACCOUNT_CONFIG`, falling back to GBP for
 * accounts that predate the config — callers should normally have
 * already filtered to known accounts.
 */
export function doAmountsAndDatesMatchForAccounts(args: {
  expenseAccount: string;
  expenseAmount: number;
  expenseDate: string;
  incomeAccount: string;
  incomeAmount: number;
  incomeDate: string;
}): boolean {
  return doAmountsAndDatesMatch({
    expenseAmount: args.expenseAmount,
    expenseCurrency: currencyOrGbp(args.expenseAccount),
    expenseDate: args.expenseDate,
    incomeAmount: args.incomeAmount,
    incomeCurrency: currencyOrGbp(args.incomeAccount),
    incomeDate: args.incomeDate,
  });
}

function currencyOrGbp(account: string): CurrencyCode {
  if (!isValidAccountName(account)) return 'GBP';
  return getAccountConfig(account).currency;
}

/**
 * Find every (expense, income) pair that crosses a legal-entity
 * boundary. Read-only; runs over the full `transactions` table and
 * returns candidate pairs whose amount, currency, and date pass the
 * same tolerance checks as `detectTransfers()`.
 *
 * Filters:
 *   - Both sides must be business accounts with a known entity id.
 *   - `expense.entityId !== income.entityId` (the whole point).
 *   - Neither side may already be typed `transfer` (those have been
 *     paired within-entity by `detectTransfers()` and are off the
 *     table for inter-company classification).
 *   - Amount/date matcher agrees.
 *
 * No duplicate avoidance between pairs: if the same income matches
 * two candidate expenses (which would be unusual), both pairs are
 * returned — the UI surfaces the ambiguity rather than picking one
 * arbitrarily.
 */
export function findInterCompanyPairs(db: Database.Database): InterCompanyPair[] {
  const incomes = db
    .prepare(
      `SELECT id, hash, date, description, amount, account
       FROM transactions
       WHERE type = 'income' AND linked_transaction_id IS NULL
       ORDER BY date`,
    )
    .all() as Array<{
      id: number;
      hash: string;
      date: string;
      description: string;
      amount: number;
      account: string;
    }>;

  const expenses = db
    .prepare(
      `SELECT id, hash, date, description, amount, account
       FROM transactions
       WHERE type = 'expense' AND linked_transaction_id IS NULL
       ORDER BY date`,
    )
    .all() as Array<{
      id: number;
      hash: string;
      date: string;
      description: string;
      amount: number;
      account: string;
    }>;

  const pairs: InterCompanyPair[] = [];

  for (const income of incomes) {
    if (!isValidAccountName(income.account)) continue;
    if (!isBusinessAccount(income.account)) continue;
    const incomeEntity = getEntityIdForAccount(income.account);
    if (incomeEntity === null) continue;

    for (const expense of expenses) {
      if (!isValidAccountName(expense.account)) continue;
      if (!isBusinessAccount(expense.account)) continue;
      const expenseEntity = getEntityIdForAccount(expense.account);
      if (expenseEntity === null) continue;
      if (expenseEntity === incomeEntity) continue;

      if (
        !doAmountsAndDatesMatchForAccounts({
          expenseAccount: expense.account,
          expenseAmount: expense.amount,
          expenseDate: expense.date,
          incomeAccount: income.account,
          incomeAmount: income.amount,
          incomeDate: income.date,
        })
      ) {
        continue;
      }

      pairs.push({
        expense: {
          id: expense.id,
          hash: expense.hash,
          date: expense.date,
          account: expense.account,
          amount: expense.amount,
          description: expense.description,
          entityId: expenseEntity,
        },
        income: {
          id: income.id,
          hash: income.hash,
          date: income.date,
          account: income.account,
          amount: income.amount,
          description: income.description,
          entityId: incomeEntity,
        },
      });
    }
  }

  return pairs;
}
