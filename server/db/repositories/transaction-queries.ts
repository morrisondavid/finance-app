/**
 * Shared primitives for querying the `transactions` table.
 *
 * Every caller that needs "expense rows whose description matches one of
 * these patterns, optionally scoped to a set of accounts and a date
 * window" funnels through {@link findExpenseTransactionsByDescriptionPatterns}
 * so there is exactly one SQL path to audit. HMRC-flavoured wrappers
 * (see `tax.ts`) and domain-specific matchers (see
 * `obligation-state-matcher.ts`) are thin adapters over this primitive.
 */
import { getDb } from '../connection.js';

export interface ExpenseTransactionMatch {
  date: string;
  amount: number;
  account: string;
  description: string;
}

export interface FindExpenseTransactionsOptions {
  /**
   * LIKE patterns OR'd together against `description`. At least one is
   * required — an empty list would match every expense row, which is
   * almost never what a caller wants.
   */
  patterns: readonly string[];
  /**
   * Optional account filter. Undefined means "all accounts"; an empty
   * array means "no accounts" and short-circuits to zero rows (distinct
   * from undefined so callers can safely pass a computed list that may
   * be empty).
   */
  accounts?: readonly string[];
  /** Inclusive ISO lower bound on `date`. */
  startDate: string;
  /** Inclusive ISO upper bound on `date`. */
  endDate: string;
}

/**
 * Return every `type='expense'` transaction whose description matches
 * any of the supplied LIKE patterns, within the date window and (when
 * supplied) the account filter. Ordered ascending by date for stable
 * downstream behaviour.
 */
export function findExpenseTransactionsByDescriptionPatterns(
  opts: FindExpenseTransactionsOptions,
): ExpenseTransactionMatch[] {
  if (opts.patterns.length === 0) return [];
  if (opts.accounts !== undefined && opts.accounts.length === 0) return [];

  const db = getDb();
  const patternCondition = opts.patterns.map(() => 'description LIKE ?').join(' OR ');
  const accountClause = opts.accounts !== undefined
    ? ` AND account IN (${opts.accounts.map(() => '?').join(',')})`
    : '';
  const accountParams = opts.accounts ?? [];

  return db.prepare(`
    SELECT date, amount, account, description
    FROM transactions
    WHERE type = 'expense'
      AND (${patternCondition})${accountClause}
      AND date >= ? AND date <= ?
    ORDER BY date ASC
  `).all(
    ...opts.patterns,
    ...accountParams,
    opts.startDate,
    opts.endDate,
  ) as ExpenseTransactionMatch[];
}
