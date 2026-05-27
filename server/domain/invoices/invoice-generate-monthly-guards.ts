/**
 * Preconditions for supplier-issued invoice generation (occupancy + monthly gap list).
 */

import type { Contract } from '../../../shared/api-contracts.js';
import { monthRange } from '../../../shared/iso-date.js';
import type { Invoice } from './schema.js';
import { allContracts } from '../contracts/index.js';
import { existingInvoicesOccupyingContractBillingMonth, normaliseBillingMonthStart } from './billing-month-occupancy.js';
import { listSupplierMonthlyInvoiceGaps } from './supplier-month-gaps.js';

export interface MonthlySupplierGenerateGuardInput {
  readonly draft: Invoice;
  readonly contract: Contract;
  readonly allInvoices: readonly Invoice[];
  readonly today: string;
  readonly allowOutsideGapList?: boolean;
}

export interface InvoiceGenerateGuardViolation {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/**
 * Returns an error envelope when generation must be blocked; otherwise `undefined`.
 */
export function violationForMonthlySupplierInvoiceGenerate(
  input: MonthlySupplierGenerateGuardInput,
): InvoiceGenerateGuardViolation | undefined {
  const { draft, contract, allInvoices, today, allowOutsideGapList } = input;

  if (contract.invoice_mechanism !== 'supplier-issued') {
    return undefined;
  }

  const billingKey = normaliseBillingMonthStart(draft.period_start);
  const { start: mStart, end: mEnd } = monthRange(billingKey);

  const occupants = existingInvoicesOccupyingContractBillingMonth(contract.id, billingKey, allInvoices);
  if (occupants.length > 0) {
    return {
      status: 409,
      body: {
        error: 'billing-month-occupied',
        message: 'An invoice row already overlaps this billing calendar month for this contract.',
        billingMonth: billingKey.slice(0, 7),
        contractId: contract.id,
        blockingInvoiceIds: occupants.map(i => i.id),
      },
    };
  }

  if (contract.invoice_cadence !== 'monthly') {
    return undefined;
  }

  if (allowOutsideGapList === true) {
    return undefined;
  }

  const gaps = listSupplierMonthlyInvoiceGaps({
    today,
    contracts: allContracts(),
    invoices: allInvoices,
  });
  const inGapList = gaps.some(
    g =>
      g.contract_id === contract.id
      && g.month_start === mStart
      && g.month_end === mEnd,
  );
  if (!inGapList) {
    return {
      status: 400,
      body: {
        error: 'not-in-supplier-month-gap-list',
        message:
          'This billing month is not listed as an open supplier monthly gap (complete past months only). Use allowOutsideGapList on the generate body to override, or pick a month that appears in GET /api/invoices/supplier-month-gaps.',
        billingMonth: billingKey.slice(0, 7),
        contractId: contract.id,
      },
    };
  }

  return undefined;
}
