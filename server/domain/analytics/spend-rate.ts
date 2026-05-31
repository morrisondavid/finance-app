/**
 * Trailing-window spend rate split personal/business × mandatory/discretionary.
 * Reuses: `getAccountConfig`, `isMandatoryCategory`, `convertAmountSync`, `transactionCategoryWithPayroll`.
 * One grouped SQL query (account + description + hash) then categorise groups in JS.
 */

import type { AccountName, EntityId } from '../../../shared/api-contracts.js';
import { isMandatoryCategory } from '../../../shared/expenses-insight.js';
import { shiftIsoDate, todayIsoLocal } from '../../../shared/iso-date.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import { getDb } from '../../db/connection.js';
import { getAccountConfig, getEntityIdForAccount } from '../accounts/queries.js';
import { transactionCategoryWithPayroll } from '../payroll/index.js';
import { round2 } from '../../utils/math.js';

const AVG_DAYS_PER_MONTH = 30.4375;

export interface SpendRateSplit {
  readonly personalDiscretionary: number;
  readonly personalMandatory: number;
  readonly businessDiscretionary: number;
  readonly businessMandatory: number;
}

export interface SpendRateResult {
  readonly windowDays: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly perDay: number;
  readonly perWeek: number;
  readonly perMonth: number;
  readonly split: SpendRateSplit;
}

type AggRow = {
  account: string;
  description: string;
  hash: string | null;
  spent: number;
};

function accountInScope(account: AccountName, entityId: EntityId | undefined): boolean {
  if (entityId === undefined) return true;
  return getEntityIdForAccount(account) === entityId;
}

function queryExpenseGroups(start: string, end: string): AggRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT account,
           description,
           hash,
           SUM(ABS(amount)) AS spent
    FROM transactions
    WHERE type = 'expense' AND date >= ? AND date <= ?
    GROUP BY account, description, hash
  `).all(start, end) as AggRow[];
}

function accumulateSplit(
  rows: readonly AggRow[],
  entityId: EntityId | undefined,
): SpendRateSplit {
  const split = {
    personalDiscretionary: 0,
    personalMandatory: 0,
    businessDiscretionary: 0,
    businessMandatory: 0,
  };

  for (const row of rows) {
    const account = row.account as AccountName;
    if (!accountInScope(account, entityId)) continue;
    const cfg = getAccountConfig(account);
    const category = transactionCategoryWithPayroll(
      row.description,
      -row.spent,
      account,
      'expense',
      row.hash ?? undefined,
    );
    const gbp = convertAmountSync(row.spent, cfg.currency, 'GBP');
    const mandatory = isMandatoryCategory(category);
    const personal = cfg.category === 'personal';
    if (personal && mandatory) split.personalMandatory = round2(split.personalMandatory + gbp);
    else if (personal && !mandatory) split.personalDiscretionary = round2(split.personalDiscretionary + gbp);
    else if (!personal && mandatory) split.businessMandatory = round2(split.businessMandatory + gbp);
    else split.businessDiscretionary = round2(split.businessDiscretionary + gbp);
  }

  return split;
}

function totalFromSplit(split: SpendRateSplit): number {
  return round2(
    split.personalDiscretionary +
    split.personalMandatory +
    split.businessDiscretionary +
    split.businessMandatory,
  );
}

export function computeSpendRateForWindow(
  windowStart: string,
  windowEnd: string,
  entityId?: EntityId,
): SpendRateResult {
  const rows = queryExpenseGroups(windowStart, windowEnd);
  const split = accumulateSplit(rows, entityId);
  const totalGbp = totalFromSplit(split);
  const windowDays = Math.max(
    1,
    Math.round(
      (Date.parse(`${windowEnd}T00:00:00Z`) - Date.parse(`${windowStart}T00:00:00Z`)) /
        (24 * 60 * 60 * 1000),
    ) + 1,
  );
  const perDay = round2(totalGbp / windowDays);
  return {
    windowDays,
    windowStart,
    windowEnd,
    perDay,
    perWeek: round2(perDay * 7),
    perMonth: round2(perDay * AVG_DAYS_PER_MONTH),
    split,
  };
}

export function computeTrailingSpendRate(
  windowDays: number,
  entityId?: EntityId,
  today: string = todayIsoLocal(),
): SpendRateResult {
  const windowEnd = today;
  const windowStart = shiftIsoDate(today, -(windowDays - 1));
  return computeSpendRateForWindow(windowStart, windowEnd, entityId);
}
