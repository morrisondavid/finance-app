/**
 * Pure workload calculation for a contract + leave rows + explicit
 * date window.
 *
 * One helper, two consumers:
 *   - {@link computeAccrual} calls it twice per response (owed window
 *     and projection window).
 *   - The §1.3 invoice draft endpoint (Phase 2) calls it once per
 *     invoice draft (selected billing period).
 *
 * Extracting the math here means the workload definition lives in
 * exactly one place — invoices and accruals cannot drift apart. When
 * VAT rules, leave semantics, or day-counting change, there is a
 * single file to edit.
 *
 * Pure — no I/O, no registry access, no global state. Inputs fully
 * specify the answer.
 */

import type {
  Contract,
  CurrencyCode,
  LeaveRow,
} from '../../../shared/api-contracts.js';
import {
  contractWeekdayMask,
  countWorkingDays,
} from '../working-days/index.js';

export interface WorkloadInput {
  readonly contract: Contract;
  readonly leaveRows: readonly LeaveRow[];
  /** ISO `YYYY-MM-DD`, inclusive. */
  readonly start: string;
  /** ISO `YYYY-MM-DD`, inclusive. */
  readonly end: string;
  /**
   * Entity-scoped public-holiday dates to exclude from working days.
   * These are **not** counted as personal leave (`leaveDays` stays
   * leave-only) but **are** subtracted from `workingDays` / `subtotal`.
   * Callers obtain this set via `holidayDatesForEntity`.
   */
  readonly publicHolidayDates?: ReadonlySet<string>;
}

export interface Workload {
  /** Mon–Fri (or contract-specific) days in `[start, end]` minus leave. */
  readonly workingDays: number;
  /** Booked leave rows for this contract falling inside `[start, end]`. */
  readonly leaveDays: number;
  /** `workingDays * contract.day_rate`. Invoice-currency denominated. */
  readonly subtotal: number;
  /** Pass-through of `contract.day_rate` so consumers can format / reuse. */
  readonly dayRate: number;
  /** Pass-through of `contract.invoice_currency`. */
  readonly currency: CurrencyCode;
}

/**
 * Collect leave dates for `contract.id` that fall in `[start, end]`.
 * Exposed so `computeAccrual` can keep its window-specific counts
 * aligned with whatever this helper uses internally.
 */
export function leaveDatesIn(
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

/**
 * Calculate the working-days / leave / subtotal triple for an
 * arbitrary `[start, end]` window on a single contract.
 *
 * A degenerate window (`start > end`) returns an all-zero `Workload`
 * rather than throwing — this mirrors the sentinel behaviour the
 * previous inline code in `computeAccrual` relied on (invalid or
 * clipped-to-empty windows produce zeros for both axes).
 */
export function calculateWorkload(input: WorkloadInput): Workload {
  const { contract, leaveRows, start, end, publicHolidayDates } = input;
  const dayRate = contract.day_rate;
  const currency = contract.invoice_currency;

  if (start > end) {
    return {
      workingDays: 0,
      leaveDays: 0,
      subtotal: 0,
      dayRate,
      currency,
    };
  }

  const mask = contractWeekdayMask(contract);
  const leaveDates = leaveDatesIn(leaveRows, contract.id, start, end);

  const excludeDates = new Set(leaveDates);
  if (publicHolidayDates) {
    for (const d of publicHolidayDates) {
      excludeDates.add(d);
    }
  }

  const workingDays = countWorkingDays({
    start,
    end,
    mask,
    excludeDates,
  });

  return {
    workingDays,
    leaveDays: leaveDates.size,
    subtotal: workingDays * dayRate,
    dayRate,
    currency,
  };
}
