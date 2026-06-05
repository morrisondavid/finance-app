/**
 * Invoice day-count reconciliation warnings (§1.4).
 *
 * Cross-checks the `days_billed` stored on each invoice against the
 * ledger-derived expected working days for the same period. Mismatches
 * indicate either incorrect leave data or a bad invoice period.
 *
 * Invoices with reversed / nonsensical periods (`period_end <
 * period_start`) are skipped — they already emit an
 * `invoice-period-invalid` warning from the Phase 4 reconciler.
 *
 * Pure: all inputs are explicit.
 */

import type {
  Contract,
  EntityFoundationWarning,
  Invoice,
  LeaveRow,
} from '../../../shared/api-contracts.js';
import { calculateWorkload } from '../contracts/workload.js';
import { holidayDatesForContract } from '../working-days/public-holidays.js';

function latestIso(...dates: string[]): string {
  return dates.reduce((a, b) => (a > b ? a : b));
}

function earliestIso(...dates: string[]): string {
  return dates.reduce((a, b) => (a < b ? a : b));
}

export interface DeriveInvoiceDaysMismatchInput {
  readonly invoices: readonly Invoice[];
  readonly contractsById: ReadonlyMap<string, Contract>;
  readonly leaveRows: readonly LeaveRow[];
}

export function deriveInvoiceDaysMismatchWarnings(
  input: DeriveInvoiceDaysMismatchInput,
): readonly EntityFoundationWarning[] {
  const { invoices, contractsById, leaveRows } = input;
  const out: EntityFoundationWarning[] = [];

  for (const inv of invoices) {
    if (inv.period_end < inv.period_start) continue;

    const contract = contractsById.get(inv.contract_id);
    if (!contract) continue;

    const ledgerStart = latestIso(inv.period_start, contract.start_date);
    const ledgerEnd = earliestIso(inv.period_end, contract.end_date);

    if (ledgerStart > ledgerEnd) continue;

    const publicHolidayDates = holidayDatesForContract(contract, ledgerStart, ledgerEnd);

    const workload = calculateWorkload({
      contract,
      leaveRows,
      start: ledgerStart,
      end: ledgerEnd,
      publicHolidayDates,
    });

    if (workload.workingDays === inv.days_billed) continue;

    out.push({
      id: `invoice-days-mismatch.${inv.id}`,
      code: 'invoice-days-mismatch',
      severity: 'warn',
      title: `Invoice ${inv.id} days_billed (${inv.days_billed}) differs from ledger (${workload.workingDays})`,
      detail: `Invoice ${inv.id} for ${inv.period_start.slice(0, 7)}: days_billed = ${inv.days_billed}, but the working-days ledger (weekday mask − leave − public holidays for ${ledgerStart}..${ledgerEnd}) gives ${workload.workingDays}. Difference: ${Math.abs(workload.workingDays - inv.days_billed)} day(s).`,
      recommended_action:
        workload.workingDays > inv.days_billed
          ? `Check whether additional leave was taken but not recorded; or confirm the invoice period / days_billed are correct.`
          : `Check whether leave rows in leave.csv are incorrect for this month; the ledger counts fewer working days than the invoice claims.`,
      sources: [`invoice:${inv.id}`, `contract:${contract.id}`],
    });
  }

  return out;
}
