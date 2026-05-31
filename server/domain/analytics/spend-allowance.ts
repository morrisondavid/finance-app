/**
 * Daily survival-plan allowance with implicit rollover.
 * Reuses: `getAccountConfig`, `isMandatoryCategory`, `convertAmountSync`, `transactionCategoryWithPayroll`.
 * One grouped SQL SUM by account + description + hash since plan start.
 */

import type { AccountName } from '../../../shared/api-contracts.js';
import { isMandatoryCategory } from '../../../shared/expenses-insight.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import { getDb } from '../../db/connection.js';
import { getAccountConfig } from '../accounts/queries.js';
import { transactionCategoryWithPayroll } from '../payroll/index.js';
import { daysBetweenIsoUtc } from '../forecast/runway-metrics.js';
import { round2 } from '../../utils/math.js';
import type { SurvivalPlanRow } from '../../db/survival-plan-csv.js';

export type SpendAllowancePeriod = 'today' | 'week';
export type SpendAllowanceStatus = 'on-track' | 'overspent' | 'ahead';

export interface SpendAllowanceResult {
  readonly plan: {
    readonly startDate: string;
    readonly dailyAmount: number;
    readonly scope: SurvivalPlanRow['scope'];
  };
  readonly period: SpendAllowancePeriod;
  readonly accruedAllowanceGbp: number;
  readonly spentGbp: number;
  readonly remainingGbp: number;
  readonly status: SpendAllowanceStatus;
  readonly tomorrowAllowanceGbp: number;
}

type AggRow = {
  account: string;
  description: string;
  hash: string | null;
  spent: number;
};

function accountInScope(
  account: AccountName,
  scope: SurvivalPlanRow['scope'],
): boolean {
  const cfg = getAccountConfig(account);
  if (scope === 'household') return true;
  return cfg.category === 'personal';
}

function sumDiscretionarySince(startDate: string, scope: SurvivalPlanRow['scope']): number {
  const db = getDb();
  const rows = db.prepare(`
    SELECT account, description, hash, SUM(ABS(amount)) AS spent
    FROM transactions
    WHERE type = 'expense' AND date >= ?
    GROUP BY account, description, hash
  `).all(startDate) as AggRow[];

  let total = 0;
  for (const row of rows) {
    const account = row.account as AccountName;
    if (!accountInScope(account, scope)) continue;
    const category = transactionCategoryWithPayroll(
      row.description,
      -row.spent,
      account,
      'expense',
      row.hash ?? undefined,
    );
    if (isMandatoryCategory(category)) continue;
    const cfg = getAccountConfig(account);
    total += convertAmountSync(row.spent, cfg.currency, 'GBP');
  }
  return round2(total);
}

export function computeSpendAllowance(
  plan: SurvivalPlanRow,
  period: SpendAllowancePeriod,
  today: string = todayIsoLocal(),
): SpendAllowanceResult {
  const dailyAmount = plan.dailyAmount;
  const daysElapsed = Math.max(0, daysBetweenIsoUtc(plan.startDate, today));
  const multiplier = period === 'week' ? 7 : daysElapsed + 1;
  const accruedAllowanceGbp = round2(dailyAmount * multiplier);
  const spentGbp = sumDiscretionarySince(plan.startDate, plan.scope);
  const remainingGbp = round2(accruedAllowanceGbp - spentGbp);

  let status: SpendAllowanceStatus = 'on-track';
  if (remainingGbp < 0) status = 'overspent';
  else if (remainingGbp >= dailyAmount) status = 'ahead';

  const tomorrowAllowanceGbp = round2(dailyAmount + remainingGbp);

  return {
    plan: {
      startDate: plan.startDate,
      dailyAmount,
      scope: plan.scope,
    },
    period,
    accruedAllowanceGbp,
    spentGbp,
    remainingGbp,
    status,
    tomorrowAllowanceGbp,
  };
}
