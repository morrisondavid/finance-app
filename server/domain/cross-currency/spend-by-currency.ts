/**
 * §3.2 — expense totals grouped by account native currency (GBP conversion via static FX).
 */

import type { CurrencyCode, EntityId } from '../../../shared/api-contracts.js';
import { ACCOUNTS } from '../../../shared/api-contracts.js';
import type { AccountName } from '../../types.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import { getTransactions } from '../../db/repositories/transactions.js';
import { transactionCategoryWithPayroll } from '../payroll/index.js';
import { SPECIAL_CATEGORY } from '../../utils/category-constants.js';
import { round2 } from '../../utils/math.js';
import { accountsForEntity, getAccountConfig, isValidAccountName } from '../accounts/queries.js';

export type SpendByCurrencyPeriod =
  | { readonly kind: 'calendarMonth'; readonly yearMonth: string }
  | { readonly kind: 'financialYear'; readonly financialYear: string };

export interface BuildSpendTotalsByCurrencyOpts {
  readonly period: SpendByCurrencyPeriod;
  readonly entityId?: EntityId;
  readonly account?: AccountName;
}

export interface SpendTotalsByCurrencyRow {
  readonly currency: CurrencyCode;
  readonly expenseNative: number;
  readonly expenseGbp: number;
  readonly transactionCount: number;
}

/** Matches §3.2 — no historical per-transaction FX audit. */
export const SPEND_BY_CURRENCY_FX_NOTE =
  'GBP equivalents use synchronous rates from server/config/exchange-rates.ts (e.g. hardcoded AED/GBP mid). Not a historical cost-basis or tax ledger.';

function resolveScopedAccounts(opts: BuildSpendTotalsByCurrencyOpts): readonly AccountName[] {
  if (opts.account !== undefined) {
    const a = opts.account;
    if (opts.entityId !== undefined) {
      const allowed = new Set(accountsForEntity(opts.entityId));
      if (!allowed.has(a)) {
        return [];
      }
    }
    return [a];
  }
  if (opts.entityId !== undefined) {
    return accountsForEntity(opts.entityId);
  }
  return ACCOUNTS;
}

function transactionFiltersForPeriod(period: SpendByCurrencyPeriod): {
  readonly financialYear?: string;
  readonly year?: string;
  readonly month?: string;
} {
  if (period.kind === 'financialYear') {
    return { financialYear: period.financialYear };
  }
  const [y, m] = period.yearMonth.split('-');
  if (y === undefined || m === undefined || y.length !== 4 || m.length !== 2) {
    throw new Error(`Invalid calendar month: ${period.yearMonth}`);
  }
  return { year: y, month: m };
}

export function buildSpendTotalsByCurrency(opts: BuildSpendTotalsByCurrencyOpts): {
  readonly totalsByCurrency: SpendTotalsByCurrencyRow[];
  readonly fxNote: string;
} {
  const accounts = resolveScopedAccounts(opts);
  const periodFilters = transactionFiltersForPeriod(opts.period);

  const nativeSum = new Map<CurrencyCode, number>();
  const countMap = new Map<CurrencyCode, number>();

  for (const accountName of accounts) {
    const rows = getTransactions({
      account: accountName,
      type: 'expense',
      ...periodFilters,
    });

    for (const row of rows) {
      if (!isValidAccountName(row.account)) continue;
      const category = transactionCategoryWithPayroll(
        row.description,
        row.amount,
        row.account,
        row.type,
        row.hash,
      );
      if (category === SPECIAL_CATEGORY.transfers) continue;

      const currency = getAccountConfig(row.account).currency;
      const amt = Math.abs(row.amount);
      nativeSum.set(currency, round2((nativeSum.get(currency) ?? 0) + amt));
      countMap.set(currency, (countMap.get(currency) ?? 0) + 1);
    }
  }

  const totalsByCurrency: SpendTotalsByCurrencyRow[] = [];
  for (const currency of [...nativeSum.keys()].sort((a, b) => a.localeCompare(b))) {
    const expenseNative = nativeSum.get(currency) ?? 0;
    const expenseGbp = round2(convertAmountSync(expenseNative, currency, 'GBP'));
    totalsByCurrency.push({
      currency,
      expenseNative,
      expenseGbp,
      transactionCount: countMap.get(currency) ?? 0,
    });
  }

  return { totalsByCurrency, fxNote: SPEND_BY_CURRENCY_FX_NOTE };
}
