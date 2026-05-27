import { z } from 'zod';
import {
  allInvoices,
  buildDraftInvoice,
  resolveBillingMonthPeriod,
  listSupplierMonthlyInvoiceGaps,
} from '../../domain/invoices/index.js';
import { findContractById, allContracts } from '../../domain/contracts/index.js';
import { findClientById } from '../../domain/clients/index.js';
import { companyById } from '../../domain/company/index.js';
import { leaveForContract } from '../../domain/leave/index.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { holidayDatesForEntity } from '../../domain/working-days/public-holidays.js';
import { IsoDateSchema, SupplierMonthGapsResponseSchema } from '../../../shared/api-contracts.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

export const InvoiceDraftQuerySchema = z.object({
  contract_id: z.string().min(1),
  billing_month: z
    .union([
      z.string().regex(/^\d{4}-\d{2}$/, 'billing_month: use YYYY-MM or YYYY-MM-DD'),
      IsoDateSchema,
    ])
    .optional(),
});

/** GET /api/invoices parity. */
export function readInvoiceList(): JsonReadResult {
  return jsonReadOk({ invoices: allInvoices() });
}

/** GET /api/invoices/supplier-month-gaps parity. */
export function readSupplierMonthGaps(): JsonReadResult {
  const today = todayIsoLocal();
  const gaps = listSupplierMonthlyInvoiceGaps({
    today,
    contracts: allContracts(),
    invoices: allInvoices(),
  });
  return jsonReadOk(SupplierMonthGapsResponseSchema.parse({ gaps }));
}

/** GET /api/invoices/draft parity (query validated like Express). */
export function readInvoiceDraftFromQuery(query: Record<string, unknown>): JsonReadResult {
  const parsed = InvoiceDraftQuerySchema.safeParse(query);
  if (!parsed.success) {
    return jsonReadFail(400, { error: 'Invalid request', details: parsed.error.issues });
  }

  const contract = findContractById(parsed.data.contract_id);
  if (contract === null) {
    return jsonReadFail(404, { error: 'Contract not found' });
  }

  if (contract.invoice_mechanism !== 'supplier-issued') {
    return jsonReadFail(400, {
      error: 'self-bill-contract',
      message:
        'This contract uses self-bill; supplier drafts are not built here. Use ingest for agency PDFs.',
    });
  }

  const client = findClientById(contract.client_id);
  if (client === null) {
    return jsonReadFail(404, { error: 'Client not found for contract' });
  }

  const company = companyById(contract.issuing_entity_id);
  if (company === null) {
    return jsonReadFail(404, { error: 'Issuing entity not found for contract' });
  }

  const today = todayIsoLocal();
  const billingMonthRaw = parsed.data.billing_month;
  const billingMonthNormalized =
    billingMonthRaw === undefined
      ? undefined
      : billingMonthRaw.length === 7
        ? `${billingMonthRaw}-01`
        : billingMonthRaw;
  if (billingMonthNormalized !== undefined) {
    if (resolveBillingMonthPeriod(contract, billingMonthNormalized) === null) {
      return jsonReadFail(400, {
        error: 'billing-month-outside-contract',
        message:
          'That month does not overlap this contract after the start/end dates are applied.',
      });
    }
  }

  const yToday = today.slice(0, 4);
  const yBill = billingMonthNormalized?.slice(0, 4) ?? yToday;
  const yMin = yBill < yToday ? yBill : yToday;
  const yMax = yBill > yToday ? yBill : yToday;
  const yearStart = `${yMin}-01-01`;
  const yearEnd = `${yMax}-12-31`;

  const draft = buildDraftInvoice({
    contract,
    client,
    company,
    leaveRows: leaveForContract(contract.id),
    existingInvoices: allInvoices(),
    today,
    billing_month: billingMonthNormalized,
    publicHolidayDates: holidayDatesForEntity(contract.issuing_entity_id, yearStart, yearEnd),
  });

  return jsonReadOk({ invoice: draft });
}
