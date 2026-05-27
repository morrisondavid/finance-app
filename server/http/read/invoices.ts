import { z } from 'zod';
import {
  allInvoices,
  composeSupplierInvoiceDraftForContract,
  listSupplierMonthlyInvoiceGaps,
} from '../../domain/invoices/index.js';
import { allContracts } from '../../domain/contracts/index.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
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

  const today = todayIsoLocal();
  const billingMonthRaw = parsed.data.billing_month;
  /** Pass through YYYY-MM or full ISO date — `compose` normalises internally. */
  const billingMonthForCompose =
    billingMonthRaw === undefined
      ? undefined
      : billingMonthRaw.length === 7
        ? billingMonthRaw
        : billingMonthRaw;

  const composed = composeSupplierInvoiceDraftForContract({
    contract_id: parsed.data.contract_id,
    billing_month: billingMonthForCompose,
    today,
  });
  if (!composed.ok) {
    return jsonReadFail(composed.status, composed.body);
  }

  return jsonReadOk({ invoice: composed.invoice });
}
