/**
 * Flags for monthly invoice preview (draft vs workload ledger).
 */

import type { Contract, Invoice, LeaveRow } from '../../../shared/api-contracts.js';
import { calculateWorkload } from '../contracts/workload.js';

export interface DraftWorkloadConsistency {
  readonly daysBilled: number;
  readonly ledgerWorkingDays: number;
  readonly match: boolean;
}

export function draftWorkloadConsistencyForInvoice(
  invoice: Invoice,
  contract: Contract,
  leaveRows: readonly LeaveRow[],
  publicHolidayDates: ReadonlySet<string> | undefined,
): DraftWorkloadConsistency {
  const workload = calculateWorkload({
    contract,
    leaveRows,
    start: invoice.period_start,
    end: invoice.period_end,
    publicHolidayDates,
  });
  return {
    daysBilled: invoice.days_billed,
    ledgerWorkingDays: workload.workingDays,
    match: workload.workingDays === invoice.days_billed,
  };
}
