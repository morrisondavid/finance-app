/**
 * Compose a supplier-issued invoice draft — shared by GET /draft and monthly invoice workflow.
 */

import { buildDraftInvoice, resolveBillingMonthPeriod } from './build-draft.js';
import { allInvoices } from './queries.js';
import type { Invoice } from './schema.js';
import { findContractById } from '../contracts/index.js';
import { findClientById } from '../clients/index.js';
import { companyById } from '../company/index.js';
import { leaveForContract } from '../leave/index.js';
import { holidayDatesForEntity } from '../working-days/public-holidays.js';

export type ComposeSupplierInvoiceDraftResult =
  | { readonly ok: true; readonly invoice: Invoice }
  | { readonly ok: false; readonly status: number; readonly body: Record<string, unknown> };

/** `billing_month` accepts YYYY-MM or full ISO date; `undefined` means builder default window. */
export function composeSupplierInvoiceDraftForContract(opts: {
  readonly contract_id: string;
  readonly billing_month?: string | undefined;
  readonly today: string;
}): ComposeSupplierInvoiceDraftResult {
  const contract = findContractById(opts.contract_id);
  if (contract === null) {
    return { ok: false, status: 404, body: { error: 'Contract not found' } };
  }

  if (contract.invoice_mechanism !== 'supplier-issued') {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'self-bill-contract',
        message:
          'This contract uses self-bill; supplier drafts are not built here. Use ingest for agency PDFs.',
      },
    };
  }

  const client = findClientById(contract.client_id);
  if (client === null) {
    return { ok: false, status: 404, body: { error: 'Client not found for contract' } };
  }

  const company = companyById(contract.issuing_entity_id);
  if (company === null) {
    return { ok: false, status: 404, body: { error: 'Issuing entity not found' } };
  }

  const billingMonthRaw = opts.billing_month;
  const billingMonthNormalized =
    billingMonthRaw === undefined
      ? undefined
      : billingMonthRaw.trim().length === 7
        ? `${billingMonthRaw.trim()}-01`
        : billingMonthRaw.trim();

  if (billingMonthNormalized !== undefined) {
    if (resolveBillingMonthPeriod(contract, billingMonthNormalized) === null) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'billing-month-outside-contract',
          message:
            'That month does not overlap this contract after the start/end dates are applied.',
        },
      };
    }
  }

  const today = opts.today;
  const yToday = today.slice(0, 4);
  const yBill = billingMonthNormalized?.slice(0, 4) ?? yToday;
  const yMin = yBill < yToday ? yBill : yToday;
  const yMax = yBill > yToday ? yBill : yToday;
  const yearStart = `${yMin}-01-01`;
  const yearEnd = `${yMax}-12-31`;

  const invoice = buildDraftInvoice({
    contract,
    client,
    company,
    leaveRows: leaveForContract(contract.id),
    existingInvoices: allInvoices(),
    today,
    billing_month: billingMonthNormalized,
    publicHolidayDates: holidayDatesForEntity(contract.issuing_entity_id, yearStart, yearEnd),
  });

  return { ok: true, invoice };
}
