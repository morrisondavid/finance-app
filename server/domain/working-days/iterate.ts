/**
 * Pure generator over calendar days that a contract actually works,
 * minus any explicitly excluded dates (leave, public holidays, etc.).
 *
 * Inputs are all ISO `YYYY-MM-DD` strings and a Mon-indexed
 * {@link WeekdayMask}. The generator yields each qualifying day in
 * chronological order. An inverted range (`end < start`) yields nothing.
 *
 * This is the single source of truth for "what calendar days count as
 * work" across the app. `income-accrual` (1.2.E) calls it with leave
 * dates as `excludeDates`; the future working-days ledger (1.4) will
 * call it with leave dates plus public holidays. No other caller
 * should reimplement the weekday-mask ∩ date-range logic.
 */

import { shiftIsoDate } from '../../../shared/iso-date.js';
import { jsDayToMondayIndex, type WeekdayMask } from './weekday-mask.js';

export interface IterateWorkingDaysInput {
  /** Inclusive start of the range (ISO `YYYY-MM-DD`). */
  start: string;
  /** Inclusive end of the range (ISO `YYYY-MM-DD`). */
  end: string;
  mask: WeekdayMask;
  /** Dates to skip regardless of the weekday mask (leave, holidays, …). */
  excludeDates?: ReadonlySet<string>;
}

export function* iterateWorkingDays(input: IterateWorkingDaysInput): Generator<string> {
  const { start, end, mask, excludeDates } = input;
  if (end < start) return;
  let cursor = start;
  while (cursor <= end) {
    const [y, m, d] = cursor.split('-').map(Number);
    const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const monIdx = jsDayToMondayIndex(jsDay);
    if (mask[monIdx] && !(excludeDates?.has(cursor) ?? false)) {
      yield cursor;
    }
    cursor = shiftIsoDate(cursor, 1);
  }
}
