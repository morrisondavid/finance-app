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
 *
 * Workload math (working-days × day_rate − leave) is delegated to
 * {@link calculateWorkload} so the §1.3 invoice draft endpoint can
 * reuse the identical primitive. The shape of `AccrualResponse` is
 * unchanged — this file only orchestrates two window definitions and
 * passes each one to `calculateWorkload`.
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
import { resolveAccrualWindowStart } from './last-payment.js';
import { calculateWorkload } from './workload.js';

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
  /**
   * Entity-scoped public-holiday dates. Forwarded to
   * `calculateWorkload` so bank holidays reduce working days without
   * inflating `leaveDays`. `undefined` is safe (holidays simply not
   * excluded — backward-compatible default).
   */
  readonly publicHolidayDates?: ReadonlySet<string>;
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

export function computeAccrual(input: ComputeAccrualInput): AccrualResponse {
  const { contract, leaveRows, today, lastPaymentDate, publicHolidayDates } = input;
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
    const projection = calculateWorkload({
      contract,
      leaveRows,
      start: period_start,
      end: period_end,
      publicHolidayDates,
    });
    projected_period_total = projection.subtotal;
    // `worked_days_remaining` is the forward-looking subset: tomorrow
    // through projection end. Same leave set, different window.
    const tomorrow = shiftIsoDate(today, 1);
    const remainingStart = tomorrow < period_start ? period_start : tomorrow;
    const remaining = calculateWorkload({
      contract,
      leaveRows,
      start: remainingStart,
      end: period_end,
      publicHolidayDates,
    });
    worked_days_remaining = remaining.workingDays;
  }

  // Owed window accumulators. Independent of the projection window.
  // `calculateWorkload` handles the degenerate (start > end) case for
  // us — it returns all-zeros, which is exactly the sentinel behaviour
  // the previous hand-rolled code produced.
  const owedWorkload = calculateWorkload({
    contract,
    leaveRows,
    start: owedStart,
    end: owedEndRaw,
    publicHolidayDates,
  });
  const owedValid = owedStart <= owedEndRaw;
  const owed_window_start = owedStart;
  // When the window is degenerate (e.g. owedStart is after today),
  // report an empty window by setting end = start so consumers render
  // a zero-day range rather than an inverted one.
  const owed_window_end = owedValid ? owedEndRaw : owedStart;
  const worked_days_to_date = owedWorkload.workingDays;
  const accrued_to_date = owedWorkload.subtotal;
  const leave_days_in_period = owedValid ? owedWorkload.leaveDays : 0;

  // Total contract lifetime value (start_date → end_date).
  // Only meaningful when the contract has a defined end_date;
  // open-ended contracts have no ceiling so both fields are null.
  let total_contract_working_days: number | null = null;
  let total_contract_value: number | null = null;
  if (contract.end_date !== null) {
    const totalWorkload = calculateWorkload({
      contract,
      leaveRows,
      start: contract.start_date,
      end: contract.end_date,
      publicHolidayDates,
    });
    total_contract_working_days = totalWorkload.workingDays;
    total_contract_value = totalWorkload.subtotal;
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
    total_contract_working_days,
    total_contract_value,
  };
}
