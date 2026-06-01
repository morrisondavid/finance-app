/**
 * Detect calendar months in the past (fully complete before `today`) where a
 * monthly supplier-issued contract has no covering non-draft invoice.
 */

import type { Contract, SupplierMonthGap } from '../../../shared/api-contracts.js';
import { monthRange, shiftIsoDate } from '../../../shared/iso-date.js';
import type { Invoice } from './schema.js';
import { isoPeriodRangesOverlap } from './period-range-overlap.js';

function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

/** First day of the month after `firstOfMonthIso` (YYYY-MM-01). */
function nextMonthFirst(firstOfMonthIso: string): string {
  const [y, m] = firstOfMonthIso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + 1, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}-01`;
}

export interface ListSupplierMonthlyInvoiceGapsInput {
  readonly today: string;
  readonly contracts: readonly Contract[];
  readonly invoices: readonly Invoice[];
}

export function listSupplierMonthlyInvoiceGaps(
  input: ListSupplierMonthlyInvoiceGapsInput,
): readonly SupplierMonthGap[] {
  const { today, contracts, invoices } = input;
  const firstOfThisMonth = monthRange(today).start;
  const lastCompleteMonthEnd = shiftIsoDate(firstOfThisMonth, -1);

  const gaps: SupplierMonthGap[] = [];

  for (const contract of contracts) {
    if (
      contract.invoice_mechanism !== 'supplier-issued'
      || contract.invoice_cadence !== 'monthly'
    ) {
      continue;
    }

    const contractEnd = contract.end_date;
    const engagementEnd = minIso(contractEnd, lastCompleteMonthEnd);
    if (contract.start_date > engagementEnd) continue;

    let monthCursor = monthRange(contract.start_date).start;
    while (monthCursor <= engagementEnd) {
      const { start: mStart, end: mEnd } = monthRange(monthCursor);
      if (mEnd > lastCompleteMonthEnd) break;

      const periodStart = maxIso(mStart, contract.start_date);
      const periodEnd = minIso(mEnd, contract.end_date);

      if (periodStart <= periodEnd) {
        const covered = invoices.some(
          inv =>
            inv.contract_id === contract.id
            && inv.status !== 'draft'
            && isoPeriodRangesOverlap(
              inv.period_start,
              inv.period_end,
              mStart,
              mEnd,
            ),
        );
        if (!covered) {
          gaps.push({
            contract_id: contract.id,
            client_id: contract.client_id,
            month_start: mStart,
            month_end: mEnd,
          });
        }
      }

      monthCursor = nextMonthFirst(monthCursor);
    }
  }

  return gaps;
}
