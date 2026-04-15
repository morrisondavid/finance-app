/**
 * Dashboard merchant modal passes `search` = display merchant label; SQL uses
 * `LIKE '%' || needle || '%'` by default. Some labels need stricter matching
 * (substring false positives, bank text variants). Keep in sync with
 * {@link ../db/repositories/transactions.js} `getTransactions` search handling.
 */

import { accumulationFromTxn, type RawTransaction } from './recurring-pipeline.js';

export type MerchantDrillSearchSql =
  | { kind: 'like_lower'; pattern: string }
  | { kind: 'regexp'; pattern: string; extraSql?: string };

function matchesUberEats(description: string): boolean {
  const d = description.toLowerCase();
  const uberAt = d.indexOf('uber');
  if (uberAt === -1) return false;
  return d.includes('eats', uberAt);
}

/**
 * Airline-shaped "Emirates" on statements: not glued after a dot (so `U.A.EMIRATES` is excluded —
 * `.` is non-word so `\b` alone would still match `EMIRATES` there), and followed by digits / "ON"
 * / "AIR…" like real card lines (`EMIRATES 622…`, `EMIRATES ON 13 FEB`, `EMIRATES AIRLINE`).
 */
const EMIRATES_AIRLINE_PATTERN = '(?<!\\.)\\bEmirates\\b(?=\\s+(?:\\d|ON\\b|AIR))';

function matchesEmirates(description: string): boolean {
  return new RegExp(EMIRATES_AIRLINE_PATTERN, 'i').test(description);
}

function matchesMceAdvis(description: string): boolean {
  return /(\bmce\b.*advis|advis.*\bmce\b)/i.test(description);
}

/**
 * When non-null, `getTransactions` should apply this instead of plain substring LIKE.
 */
export function merchantDrillSearchSql(searchRaw: string): MerchantDrillSearchSql | null {
  const needle = searchRaw.trim();
  if (needle.length === 0) return null;
  const lower = needle.toLowerCase();
  if (lower === 'uber eats') {
    return { kind: 'like_lower', pattern: '%uber%eats%' };
  }
  if (lower === 'emirates') {
    return { kind: 'regexp', pattern: EMIRATES_AIRLINE_PATTERN };
  }
  // cleanFallback() can append dates/refs; bank text is usually "PAN PACIFIC …" only.
  if (lower.startsWith('pan pacific')) {
    return { kind: 'like_lower', pattern: '%pan%pacific%' };
  }
  if (/^mce\b/i.test(needle) && /advis/i.test(needle)) {
    return { kind: 'regexp', pattern: '(\\bmce\\b.*advis|advis.*\\bmce\\b)' };
  }
  return null;
}

export function transactionDescriptionMatchesDrillSearch(description: string, search: string): boolean {
  const needle = search.trim();
  if (needle.length === 0) return false;
  const lower = needle.toLowerCase();
  if (lower === 'uber eats') return matchesUberEats(description);
  if (lower === 'emirates') return matchesEmirates(description);
  if (/^mce\b/i.test(needle) && /advis/i.test(needle)) return matchesMceAdvis(description);
  return description.toLowerCase().includes(lower);
}

/**
 * One definition for budget nudge cards and the merchant drill modal: when
 * {@link merchantDrillSearchSql} is specialised (Emirates, Uber Eats, …), use the same
 * description rules as SQL search; otherwise match pipeline `displayMerchant` so registry
 * labels (e.g. Byron Redstar Sponsorship) align with bank text that never contains the label.
 */
export function expenseTxnMatchesMerchantModal(txn: RawTransaction, displayMerchant: string): boolean {
  const label = displayMerchant.trim();
  if (label.length === 0) return false;
  if (merchantDrillSearchSql(label) !== null) {
    return transactionDescriptionMatchesDrillSearch(txn.description, label);
  }
  const acc = accumulationFromTxn(txn, 'expense');
  return acc !== null && acc.displayMerchant === label;
}
