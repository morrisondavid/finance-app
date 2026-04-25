/**
 * Reverse-compute leave rows from historical DC invoices.
 *
 * For each **calendar month** covered by a DC invoice, we compute:
 *   `expectedWorkingDays = countWorkingDays(monthStart, monthEnd, mask, publicHolidays)`
 *   `impliedLeave = expectedWorkingDays − invoice.days_billed`
 *
 * When `impliedLeave > 0`, we generate that many leave rows dated to
 * the **last N working days** in the month (convention: assume leave was
 * taken at month-end unless the user later re-dates them).
 *
 * The resulting rows use `type = 'holiday'` (safe default) and carry
 * a note linking back to the source invoice for traceability.
 *
 * Pure — all inputs are explicit; no I/O.
 */

import type {
  Contract,
  Invoice,
  LeaveRow,
} from '../../../shared/api-contracts.js';
import { monthRange } from '../../../shared/iso-date.js';
import {
  contractWeekdayMask,
  countWorkingDays,
  iterateWorkingDays,
} from '../working-days/index.js';
import { composeLeaveId } from './csv-io.js';

export interface ComputeImpliedLeaveInput {
  readonly invoice: Invoice;
  readonly contract: Contract;
  readonly publicHolidayDates: ReadonlySet<string>;
  readonly now: string;
}

/**
 * Generate implied leave rows for a single invoice's calendar month.
 * Returns an empty array when billed days equal or exceed expected.
 */
export function computeImpliedLeave(input: ComputeImpliedLeaveInput): LeaveRow[] {
  const { invoice, contract, publicHolidayDates, now } = input;

  const { start: monthStart, end: monthEnd } = monthRange(invoice.period_start);
  const mask = contractWeekdayMask(contract);
  const expectedDays = countWorkingDays({
    start: monthStart,
    end: monthEnd,
    mask,
    excludeDates: publicHolidayDates,
  });

  const impliedCount = expectedDays - invoice.days_billed;
  if (impliedCount <= 0) return [];

  const workingDays = [...iterateWorkingDays({
    start: monthStart,
    end: monthEnd,
    mask,
    excludeDates: publicHolidayDates,
  })];

  const leaveDates = workingDays.slice(-impliedCount);

  return leaveDates.map(date => ({
    id: composeLeaveId(contract.id, date),
    contract_id: contract.id,
    date,
    type: 'holiday' as const,
    notes: `Implied from invoice ${invoice.id}`,
    external_logged: false,
    created_at: now,
    updated_at: now,
  }));
}
