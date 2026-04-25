/**
 * Pure runway / stress metrics from forecast account series (household merge by currency).
 */

import type { CurrencyCode } from '../../../shared/api-contracts.js';
import type { ForecastAccountSeries, ForecastDailyPoint } from './build-forecast.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Merge all account daily series for a single currency into one series
 * (family-holistic cash path in that currency).
 */
export function mergeAccountSeriesByCurrency(
  accounts: readonly ForecastAccountSeries[],
  currency: CurrencyCode,
): ForecastDailyPoint[] {
  const byDate = new Map<string, number>();
  for (const s of accounts) {
    if (s.currency !== currency) continue;
    for (const pt of s.daily) {
      byDate.set(pt.date, round2((byDate.get(pt.date) ?? 0) + pt.balance));
    }
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, balance]) => ({ date, balance: round2(balance) }));
}

/** First calendar date where balance is strictly negative (cash stress). */
export function firstNegativeBalanceDate(daily: readonly ForecastDailyPoint[]): string | null {
  for (const pt of daily) {
    if (pt.balance < 0) {
      return pt.date;
    }
  }
  return null;
}

export function daysBetweenIsoUtc(start: string, end: string): number {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  const t1 = Date.parse(`${end}T00:00:00Z`);
  return Math.round((t1 - t0) / (24 * 60 * 60 * 1000));
}

const AVG_DAYS_PER_MONTH = 30.4375;

/**
 * Fractional months from `today` to `stressDate`, or `null` if `stressDate` is null.
 */
export function runwayMonthsToDate(today: string, stressDate: string | null): number | null {
  if (stressDate === null) return null;
  const days = daysBetweenIsoUtc(today, stressDate);
  if (days < 0) return 0;
  return round2(days / AVG_DAYS_PER_MONTH);
}
