/**
 * Apply user line edits to a supplier draft after preview fingerprint matched.
 */

import { monthRange } from '../../../shared/iso-date.js';
import type { Invoice } from './schema.js';

export type ApplySupplierDraftLineEditsResult =
  | { readonly ok: true; readonly invoice: Invoice }
  | { readonly ok: false; readonly status: number; readonly body: Record<string, unknown> };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function applySupplierDraftLineEdits(params: {
  readonly base: Invoice;
  readonly days_billed?: number | undefined;
  readonly description?: string | undefined;
  readonly period_end?: string | undefined;
}): ApplySupplierDraftLineEditsResult {
  const next: Invoice = { ...params.base };

  const { start: billStart, end: billEnd } = monthRange(params.base.period_start);
  const nextEnd =
    params.period_end === undefined
      ? params.base.period_end
      : params.period_end.trim();
  if (params.period_end !== undefined && params.period_end !== '') {
    if (nextEnd < billStart || nextEnd > billEnd) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'period-end-outside-billing-month',
          message:
            '`period_end` must fall within the same calendar month as the draft `period_start`.',
          period_start: billStart,
          month_end: billEnd,
          period_end: nextEnd,
        },
      };
    }
    next.period_end = nextEnd;
  }

  const daysRaw = params.days_billed ?? params.base.days_billed;
  if (!Number.isInteger(daysRaw) || daysRaw <= 0) {
    return {
      ok: false,
      status: 400,
      body: { error: 'invalid-days-billed', message: '`days_billed` must be a positive integer.' },
    };
  }
  next.days_billed = daysRaw;

  next.description =
    params.description !== undefined ? params.description.trim() : params.base.description;

  const rate = params.base.subtotal / Math.max(params.base.days_billed, 1);
  const subtotal = round2(rate * next.days_billed);
  next.subtotal = subtotal;
  next.vat_amount = round2(subtotal * next.vat_rate);
  next.total = round2(subtotal + next.vat_amount);

  return { ok: true, invoice: next };
}
