/**
 * Pure per-contract income accrual.
 *
 * "What will this contract invoice for, if the current period ended
 * right now?" — the snapshot the Contracts tab renders.
 *
 * The algorithm is a thin composition over Phase 0 primitives:
 *
 *   1. Pick the reporting window: always the calendar month containing
 *      `today`, regardless of `invoice_cadence`. This gives a consistent
 *      "what will I receive this month?" figure on every tile; the
 *      cadence badge on the contract meta row still tells the user
 *      *how* they invoice (weekly self-bill vs monthly supplier-issued).
 *      Clipped to the contract's own `[start_date, end_date]`.
 *   2. Build the weekday mask from the contract's `works_*` flags.
 *   3. Collect leave dates overlapping the period into an
 *      `excludeDates` set — every leave row reduces billable days
 *      (there is no `paid` flag; outside-IR35 contracting has no
 *      paid-leave concept).
 *   4. Count working days from `period_start..today` (`worked_days_to_date`)
 *      and `tomorrow..period_end` (`worked_days_remaining`). Both
 *      counts honour the mask and `excludeDates`.
 *   5. `accrued_to_date = worked_days_to_date * day_rate`.
 *   6. `projected_period_total = (worked_days_to_date + worked_days_remaining) * day_rate`.
 *
 * The function is total: even pathological inputs (contract entirely
 * outside the billing period, `today` before the contract starts, zero
 * masked days) return a well-formed {@link AccrualResponse} with zeroed
 * counts. No I/O, no registries.
 */

import type {
  AccrualResponse,
  Contract,
  LeaveRow,
} from '../../../shared/api-contracts.js';
import {
  monthRange,
  shiftIsoDate,
} from '../../../shared/iso-date.js';
import {
  contractWeekdayMask,
  countWorkingDays,
} from '../working-days/index.js';

export interface ComputeAccrualInput {
  readonly contract: Contract;
  readonly leaveRows: readonly LeaveRow[];
  /** ISO `YYYY-MM-DD`; pinned by callers so results are deterministic. */
  readonly today: string;
}

/**
 * Reporting window is always the calendar month containing `today`.
 * The `contract` parameter is retained for forward-compat (future
 * overrides for short SOWs that span < 1 month) but is currently
 * unused — cadence no longer influences the window.
 */
function pickPeriod(_contract: Contract, today: string): { start: string; end: string } {
  return monthRange(today);
}

/** Clip `[start, end]` against `[lower, upper?]`. Returns null if empty. */
function clip(
  start: string,
  end: string,
  lower: string,
  upper: string | null,
): { start: string; end: string } | null {
  const clippedStart = start < lower ? lower : start;
  const clippedEnd = upper !== null && end > upper ? upper : end;
  return clippedEnd < clippedStart ? null : { start: clippedStart, end: clippedEnd };
}

function leaveDatesIn(
  leaveRows: readonly LeaveRow[],
  contractId: string,
  start: string,
  end: string,
): Set<string> {
  const out = new Set<string>();
  for (const row of leaveRows) {
    if (row.contract_id !== contractId) continue;
    if (row.date < start || row.date > end) continue;
    out.add(row.date);
  }
  return out;
}

export function computeAccrual(input: ComputeAccrualInput): AccrualResponse {
  const { contract, leaveRows, today } = input;

  const rawPeriod = pickPeriod(contract, today);
  const clipped = clip(
    rawPeriod.start,
    rawPeriod.end,
    contract.start_date,
    contract.end_date,
  );

  const mask = contractWeekdayMask(contract);
  const day_rate = contract.day_rate;
  const currency = contract.invoice_currency;

  if (clipped === null) {
    return {
      contract_id: contract.id,
      period_start: rawPeriod.start,
      period_end: rawPeriod.end,
      worked_days_to_date: 0,
      accrued_to_date: 0,
      worked_days_remaining: 0,
      projected_period_total: 0,
      leave_days_in_period: 0,
      day_rate,
      currency,
    };
  }

  const period_start = clipped.start;
  const period_end = clipped.end;

  const excludeDates = leaveDatesIn(
    leaveRows,
    contract.id,
    period_start,
    period_end,
  );
  const leave_days_in_period = excludeDates.size;

  const toDateEnd = today < period_start ? null : today > period_end ? period_end : today;
  const worked_days_to_date =
    toDateEnd === null
      ? 0
      : countWorkingDays({
          start: period_start,
          end: toDateEnd,
          mask,
          excludeDates,
        });

  const tomorrow = shiftIsoDate(today, 1);
  const remainingStart = tomorrow < period_start ? period_start : tomorrow;
  const worked_days_remaining =
    remainingStart > period_end
      ? 0
      : countWorkingDays({
          start: remainingStart,
          end: period_end,
          mask,
          excludeDates,
        });

  const accrued_to_date = worked_days_to_date * day_rate;
  const projected_period_total =
    (worked_days_to_date + worked_days_remaining) * day_rate;

  return {
    contract_id: contract.id,
    period_start,
    period_end,
    worked_days_to_date,
    accrued_to_date,
    worked_days_remaining,
    projected_period_total,
    leave_days_in_period,
    day_rate,
    currency,
  };
}
