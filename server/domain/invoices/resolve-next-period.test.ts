/**
 * `resolveNextPeriodStart` locks the §1.3 fallback chain in pure-
 * function form. Phase 1 covers steps 1 and 4 only; steps 2 and 3
 * land in Phase 4 and will extend these cases rather than replace
 * them.
 */

import { describe, it, expect } from 'vitest';
import { resolveNextPeriodStart } from './resolve-next-period.js';
import { parseContractRow } from '../contracts/csv-io.js';
import { dcSowRowMarchStart } from '../contracts/test-helpers.js';
import { parseInvoiceRow } from './csv-io.js';
import {
  dcInvoice001,
  dcInvoice002,
  rowFromHeaders,
} from './test-helpers.js';

const contract = parseContractRow(dcSowRowMarchStart); // start_date = 2026-03-02

describe('resolveNextPeriodStart', () => {
  it('falls back to month-start when the contract has no invoices (step 4)', () => {
    expect(
      resolveNextPeriodStart({ contract, invoices: [], today: '2026-04-15' }),
    ).toBe('2026-04-01');
  });

  it('clamps month-start to contract.start_date', () => {
    // today sits in the same month the contract begins — month-start
    // (2026-03-01) is earlier than `contract.start_date` (2026-03-02),
    // so we clamp forward.
    expect(
      resolveNextPeriodStart({ contract, invoices: [], today: '2026-03-15' }),
    ).toBe('2026-03-02');
  });

  it('uses latest non-draft invoice period_end + 1 when one exists (step 1)', () => {
    const paid = parseInvoiceRow(dcInvoice002); // period_end 2025-07-29, status paid
    expect(
      resolveNextPeriodStart({
        contract,
        invoices: [parseInvoiceRow(dcInvoice001), paid],
        today: '2026-04-10',
      }),
    ).toBe('2026-03-02'); // clamped: 2025-07-30 < contract.start_date
  });

  it('honours step 1 without clamping when the invoice sits inside the contract window', () => {
    const midContractInvoice = parseInvoiceRow(
      rowFromHeaders({
        ...dcInvoice001,
        id: 'UK-0100',
        invoice_number: 'UK-0100',
        invoice_date: '2026-04-01',
        period_start: '2026-03-02',
        period_end: '2026-03-31',
        status: 'issued',
      }),
    );
    expect(
      resolveNextPeriodStart({
        contract,
        invoices: [midContractInvoice],
        today: '2026-04-15',
      }),
    ).toBe('2026-04-01');
  });

  it('ignores draft invoices (step 1 looks only at non-draft)', () => {
    const draft = parseInvoiceRow(
      rowFromHeaders({
        ...dcInvoice001,
        id: 'UK-0200',
        invoice_number: 'UK-0200',
        invoice_date: '2026-04-10',
        period_start: '2026-04-01',
        period_end: '2026-04-09',
        status: 'draft',
      }),
    );
    expect(
      resolveNextPeriodStart({
        contract,
        invoices: [draft],
        today: '2026-04-15',
      }),
    ).toBe('2026-04-01'); // falls through to step 4
  });

  it('picks the greatest invoice_date when multiple non-drafts are present', () => {
    const earlier = parseInvoiceRow(
      rowFromHeaders({
        ...dcInvoice001,
        id: 'UK-0300',
        invoice_number: 'UK-0300',
        invoice_date: '2026-04-01',
        period_start: '2026-03-02',
        period_end: '2026-03-31',
        status: 'issued',
      }),
    );
    const later = parseInvoiceRow(
      rowFromHeaders({
        ...dcInvoice001,
        id: 'UK-0301',
        invoice_number: 'UK-0301',
        invoice_date: '2026-05-01',
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        status: 'paid',
      }),
    );
    // Input order deliberately reversed to prove the scan picks by
    // `invoice_date`, not position.
    expect(
      resolveNextPeriodStart({
        contract,
        invoices: [later, earlier],
        today: '2026-05-15',
      }),
    ).toBe('2026-05-01');
  });
});
