/**
 * Pure per-contract income accrual.
 *
 * Two reporting windows live on every response because they answer
 * different questions — see {@link AccrualResponseSchema} for the
 * canonical statement of what each field means.
 *
 *   - Window A (the "owed" window) starts the day after the most
 *     recent matched invoice payment and runs up to `today`. When no
 *     payment has been matched (new contracts, UAE FZCO before the
 *     first payment lands, etc.) it falls back to the first of the
 *     current calendar month. This window drives
 *     `worked_days_to_date`, `accrued_to_date`, and
 *     `leave_days_in_period`. It is clamped to the contract's own
 *     `start_date` / `end_date` at both ends.
 *
 *   - Window B (the "projection" window) is always the calendar month
 *     containing `today`, clipped to the contract's
 *     `[start_date, end_date]`. It drives `worked_days_remaining` and
 *     `projected_period_total`, and keeps the Retained / VAT / CT
 *     aggregate banner on calendar-month semantics.
 *
 * The `lastPaymentDate` input is a simple string passed in by the
 * route layer — the actual transaction lookup lives in
 * {@link ../contracts/last-payment.ts} and the DB glue lives in the
 * route. This function is pure and has no I/O.
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
import { resolveAccrualWindowStart } from './last-payment.js';

export interface ComputeAccrualInput {
  readonly contract: Contract;
  readonly leaveRows: readonly LeaveRow[];
  /** ISO `YYYY-MM-DD`; pinned by callers so results are deterministic. */
  readonly today: string;
  /**
   * ISO date of the most recent matched invoice payment for this
   * contract, or `null` when none has been matched. `null` is the
   * right value for brand-new contracts (including FZCO before the
   * first payment lands) and causes the owed window to fall back to
   * the first of the current calendar month.
   */
  readonly lastPaymentDate: string | null;
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

/**
 * Build the set of leave dates relevant to one window. The two windows
 * (owed / projection) may overlap, may be disjoint, or may coincide —
 * we filter at the window level so a leave row in one window but not
 * the other is counted correctly on each axis.
 */
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
  const { contract, leaveRows, today, lastPaymentDate } = input;

  const mask = contractWeekdayMask(contract);
  const day_rate = contract.day_rate;
  const currency = contract.invoice_currency;

  // Window B — projection, always the calendar month containing
  // `today`, clipped to the contract. Drives `projected_period_total`
  // and the aggregate banner.
  const rawProjection = monthRange(today);
  const clippedProjection = clip(
    rawProjection.start,
    rawProjection.end,
    contract.start_date,
    contract.end_date,
  );

  // Window A — owed since last payment. Start defers to
  // `resolveAccrualWindowStart` so the fallback policy (month-start on
  // null payment, clamp to contract.start_date) is authored once and
  // re-used by other consumers.
  const owedStart = resolveAccrualWindowStart({
    contract,
    lastPaymentDate,
    today,
  });
  // Upper bound: today, clipped to contract end when the contract has
  // already ended. A contract that ended before today owes nothing
  // past its end date.
  const contractEndCap = contract.end_date ?? today;
  const owedEndRaw = today < contractEndCap ? today : contractEndCap;
  // Sentinel for a degenerate window (start > end): owedStart ahead of
  // both today and contract end. When owedStart > owedEndRaw we simply
  // report zeros for the owed axis — this happens when a payment was
  // logged today (or the clamp to contract.start_date moves the
  // window past `today`).
  const owedValid = owedStart <= owedEndRaw;

  // Projection accumulators. Zero when the projection window is empty.
  let period_start: string;
  let period_end: string;
  let worked_days_remaining: number;
  let projected_period_total: number;
  if (clippedProjection === null) {
    period_start = rawProjection.start;
    period_end = rawProjection.end;
    worked_days_remaining = 0;
    projected_period_total = 0;
  } else {
    period_start = clippedProjection.start;
    period_end = clippedProjection.end;
    // Leave in the projection window feeds `projected_period_total` via
    // excludeDates (the whole month's working days minus booked leave
    // × day_rate is "what you'll invoice this month").
    const projectionLeaveDates = leaveDatesIn(
      leaveRows,
      contract.id,
      period_start,
      period_end,
    );
    const projectedWorkingDays = countWorkingDays({
      start: period_start,
      end: period_end,
      mask,
      excludeDates: projectionLeaveDates,
    });
    projected_period_total = projectedWorkingDays * day_rate;
    // `worked_days_remaining` is the forward-looking subset: tomorrow
    // through projection end. Used by the per-contract endpoint only;
    // no aggregate banner consumer today.
    const tomorrow = shiftIsoDate(today, 1);
    const remainingStart = tomorrow < period_start ? period_start : tomorrow;
    worked_days_remaining = remainingStart > period_end
      ? 0
      : countWorkingDays({
          start: remainingStart,
          end: period_end,
          mask,
          excludeDates: projectionLeaveDates,
        });
  }

  // Owed window accumulators. Independent of the projection window.
  let owed_window_start: string;
  let owed_window_end: string;
  let worked_days_to_date: number;
  let accrued_to_date: number;
  let leave_days_in_period: number;
  if (!owedValid) {
    owed_window_start = owedStart;
    owed_window_end = owedStart;
    worked_days_to_date = 0;
    accrued_to_date = 0;
    leave_days_in_period = 0;
  } else {
    owed_window_start = owedStart;
    owed_window_end = owedEndRaw;
    const owedLeaveDates = leaveDatesIn(
      leaveRows,
      contract.id,
      owed_window_start,
      owed_window_end,
    );
    leave_days_in_period = owedLeaveDates.size;
    worked_days_to_date = countWorkingDays({
      start: owed_window_start,
      end: owed_window_end,
      mask,
      excludeDates: owedLeaveDates,
    });
    accrued_to_date = worked_days_to_date * day_rate;
  }

  return {
    contract_id: contract.id,
    period_start,
    period_end,
    owed_window_start,
    owed_window_end,
    worked_days_to_date,
    accrued_to_date,
    worked_days_remaining,
    projected_period_total,
    leave_days_in_period,
    day_rate,
    currency,
  };
}
