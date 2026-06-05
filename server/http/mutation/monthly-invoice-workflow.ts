/**
 * Monthly supplier-issued invoice workflow — preview/commit shared by HTTP + MCP.
 */

import { z } from 'zod';

import { InvoiceSchema } from '../../../shared/api-contracts.js';
import { monthRange, previousCompleteBillingMonthYYYYMM, todayIsoLocal } from '../../../shared/iso-date.js';
import {
  type ComposeSupplierInvoiceDraftResult,
  allInvoices,
  applySupplierDraftLineEdits,
  composeSupplierInvoiceDraftForContract,
  draftWorkloadConsistencyForInvoice,
  existingInvoicesOccupyingContractBillingMonth,
  listSupplierMonthlyInvoiceGaps,
  normaliseBillingMonthStart,
  previewFingerprintForMonthlyInvoiceDraft,
  resolveMonthlyInvoiceContract,
  violationForMonthlySupplierInvoiceGenerate,
} from '../../domain/invoices/index.js';
import { findContractById, allContracts } from '../../domain/contracts/index.js';
import { holidayDatesForContract } from '../../domain/working-days/public-holidays.js';
import { leaveForContract } from '../../domain/leave/index.js';

import { deliverInvoiceIssuedNotice } from '../../domain/outbound/invoice-delivery-adapter.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from '../read/types.js';
import type { JsonMutationResult } from './types.js';

import { mutateInvoiceGenerate } from './invoices.js';

const MonthlyInvoiceTargetBodySchema = z
  .object({
    contract_id: z.string().min(1).optional(),
    client_name: z.string().optional(),
    billing_month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  })
  .refine(
    d =>
      (d.contract_id !== undefined && d.contract_id.trim() !== '')
      || (d.client_name !== undefined && d.client_name.trim() !== ''),
    { message: 'Provide contract_id or client_name' },
  );

export const MonthlyInvoicePreviewBodySchema = MonthlyInvoiceTargetBodySchema;

export const MonthlyInvoiceCommitBodySchema = MonthlyInvoiceTargetBodySchema.extend({
  previewFingerprint: z.string().min(1),
  allowOutsideGapList: z.boolean().optional(),
  days_billed: z.number().int().positive().optional(),
  description: z.string().min(1).optional(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function composeOrFail(contractId: string, billingYm: string, today: string): ComposeSupplierInvoiceDraftResult {
  return composeSupplierInvoiceDraftForContract({
    contract_id: contractId,
    billing_month: billingYm,
    today,
  });
}

function holidayYearWindow(todayIso: string, periodStartIso: string): { yearStart: string; yearEnd: string } {
  const yToday = todayIso.slice(0, 4);
  const yBill = periodStartIso.slice(0, 4);
  const yMin = yBill < yToday ? yBill : yToday;
  const yMax = yBill > yToday ? yBill : yToday;
  return { yearStart: `${yMin}-01-01`, yearEnd: `${yMax}-12-31` };
}

/** POST `/api/invoices/monthly/preview` parity. */
export function mutateMonthlyInvoicePreview(body: unknown): JsonReadResult {
  const parsed = MonthlyInvoicePreviewBodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return jsonReadFail(400, { error: 'Invalid request', details: parsed.error.issues });
  }

  const today = todayIsoLocal();
  const billingMonth =
    parsed.data.billing_month?.trim() ?? previousCompleteBillingMonthYYYYMM(today);

  const resolved = resolveMonthlyInvoiceContract({
    contract_id: parsed.data.contract_id,
    client_name: parsed.data.client_name,
  });

  if (resolved.status === 'ambiguous') {
    return jsonReadFail(409, {
      error: 'ambiguous-contract',
      message: resolved.message,
      candidates: resolved.candidates,
    });
  }
  if (resolved.status === 'none') {
    return jsonReadFail(400, { error: 'contract-not-found', message: resolved.message });
  }

  const contractId = resolved.contract_id;
  const composed = composeOrFail(contractId, billingMonth, today);
  if (!composed.ok) {
    return jsonReadFail(composed.status, composed.body);
  }

  const contract = findContractById(contractId);
  if (contract === null) {
    return jsonReadFail(500, { error: 'Invariant: contract vanished after compose' });
  }

  const { yearStart, yearEnd } = holidayYearWindow(today, composed.invoice.period_start);

  const workload = draftWorkloadConsistencyForInvoice(
    composed.invoice,
    contract,
    leaveForContract(contract.id),
    holidayDatesForContract(contract, yearStart, yearEnd),
  );

  const billingKeyStart = normaliseBillingMonthStart(composed.invoice.period_start);
  const occupants = existingInvoicesOccupyingContractBillingMonth(contractId, billingKeyStart, allInvoices());
  const occupancyBlocked = occupants.length > 0;

  let outsideSupplierGapList = false;
  if (contract.invoice_mechanism === 'supplier-issued' && contract.invoice_cadence === 'monthly') {
    const { start: mStart, end: mEnd } = monthRange(billingKeyStart);
    const gaps = listSupplierMonthlyInvoiceGaps({
      today,
      contracts: allContracts(),
      invoices: allInvoices(),
    });
    const inList = gaps.some(
      g => g.contract_id === contractId && g.month_start === mStart && g.month_end === mEnd,
    );
    outsideSupplierGapList = !inList;
  }

  return jsonReadOk({
    contract_id: contractId,
    billing_month: billingMonth,
    previewFingerprint: previewFingerprintForMonthlyInvoiceDraft(composed.invoice),
    invoice: composed.invoice,
    occupancy: {
      blocked: occupancyBlocked,
      blockingInvoiceIds: occupants.map(i => i.id),
    },
    gapList: { outsideMonthlyGapList: outsideSupplierGapList },
    workload,
  });
}

/** POST `/api/invoices/monthly/commit` parity. */
export async function mutateMonthlyInvoiceCommit(body: unknown): Promise<JsonMutationResult> {
  const parsed = MonthlyInvoiceCommitBodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: 'Invalid request', details: parsed.error.issues },
    };
  }

  const today = todayIsoLocal();
  const billingMonth =
    parsed.data.billing_month?.trim() ?? previousCompleteBillingMonthYYYYMM(today);

  const resolved = resolveMonthlyInvoiceContract({
    contract_id: parsed.data.contract_id,
    client_name: parsed.data.client_name,
  });

  if (resolved.status === 'ambiguous') {
    return {
      status: 409,
      body: {
        error: 'ambiguous-contract',
        message: resolved.message,
        candidates: resolved.candidates,
      },
    };
  }
  if (resolved.status === 'none') {
    return { status: 400, body: { error: 'contract-not-found', message: resolved.message } };
  }

  const contractId = resolved.contract_id;
  const contract = findContractById(contractId);
  if (contract === null) {
    return { status: 500, body: { error: 'Invariant: unknown contract after resolve' } };
  }

  const composed = composeOrFail(contractId, billingMonth, today);
  if (!composed.ok) {
    return { status: composed.status, body: composed.body };
  }

  const expectedFingerprint = previewFingerprintForMonthlyInvoiceDraft(composed.invoice);
  if (parsed.data.previewFingerprint.trim() !== expectedFingerprint) {
    return {
      status: 409,
      body: {
        error: 'stale-monthly-preview',
        message:
          '`previewFingerprint` does not match a fresh compose for this target — run preview again.',
      },
    };
  }

  const lineEdit = applySupplierDraftLineEdits({
    base: composed.invoice,
    days_billed: parsed.data.days_billed,
    description: parsed.data.description,
    period_end: parsed.data.period_end,
  });

  if (!lineEdit.ok) {
    return { status: lineEdit.status, body: lineEdit.body };
  }

  const finalDraft = lineEdit.invoice;

  const guard = violationForMonthlySupplierInvoiceGenerate({
    draft: finalDraft,
    contract,
    allInvoices: allInvoices(),
    today,
    allowOutsideGapList: parsed.data.allowOutsideGapList ?? false,
  });
  if (guard !== undefined) {
    return { status: guard.status, body: guard.body };
  }

  const generation = await mutateInvoiceGenerate({
    invoice: finalDraft,
    allowOutsideGapList: parsed.data.allowOutsideGapList ?? false,
  });

  if (generation.status !== 200 || typeof generation.body !== 'object' || generation.body === null) {
    return generation;
  }

  const rawInv = Reflect.get(generation.body, 'invoice');
  const validated = InvoiceSchema.safeParse(rawInv);
  if (!validated.success) return generation;

  const noticeResult = await deliverInvoiceIssuedNotice(validated.data);

  return {
    status: 200,
    body: {
      invoice: validated.data,
      issuedNoticeDelivery: noticeResult,
    },
  };
}
