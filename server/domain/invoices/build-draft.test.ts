/**
 * Unit tests for `buildDraftInvoice`.
 *
 * The builder is pure composition over Phase-1 primitives; each test
 * drives a single primitive's contribution to the draft (period
 * window, workload, VAT, id sequence, due date) to guarantee the
 * composition stays honest.
 */

import { describe, it, expect } from 'vitest';
import { buildDraftInvoice } from './build-draft.js';
import { parseContractRow } from '../contracts/csv-io.js';
import { parseClientRow } from '../clients/csv-io.js';
import { parseCompanyRow } from '../company/csv-io.js';
import { parseInvoiceRow } from './csv-io.js';
import { dcSowRow } from '../contracts/test-helpers.js';
import { directRow, agencyRow } from '../clients/test-helpers.js';
import { ukRow, uaeRow } from '../company/test-helpers.js';
import { dcInvoice001, dcInvoice002, fzcoInvoice001 } from './test-helpers.js';
import type { LeaveRow } from '../../../shared/api-contracts.js';

const deltaCapita = parseClientRow(directRow);
const laFosse = parseClientRow(agencyRow);
const dc = parseContractRow(dcSowRow);
const ukLtd = parseCompanyRow(ukRow);
const fzco = parseCompanyRow(uaeRow);

describe('buildDraftInvoice — happy path (DC SOW, UK Ltd, no prior invoices)', () => {
  const today = '2026-04-20'; // a Monday in April
  const draft = buildDraftInvoice({
    contract: dc,
    client: deltaCapita,
    company: ukLtd,
    leaveRows: [],
    existingInvoices: [],
    today,
  });

  it('assigns a Delta Capita DC id and matching invoice / payment refs', () => {
    expect(draft.id).toBe('DC-001');
    expect(draft.invoice_number).toBe('DC-001');
    expect(draft.payment_reference).toBe('DC-001');
  });

  it('starts the period at the calendar month start (no prior non-draft invoices)', () => {
    expect(draft.period_start).toBe('2026-04-01');
  });

  it('ends the period at the calendar month end when the contract end is later', () => {
    expect(draft.period_end).toBe('2026-04-30');
  });

  it('counts working days as Mon-Fri in the window', () => {
    // April 2026: 22 Mon-Fri days in [2026-04-01, 2026-04-30].
    expect(draft.days_billed).toBe(22);
  });

  it('subtotal = days × day_rate', () => {
    expect(draft.subtotal).toBe(22 * 550);
  });

  it('applies 20% VAT for UK Ltd vat-registered entity', () => {
    expect(draft.vat_rate).toBe(0.2);
    expect(draft.vat_amount).toBeCloseTo(22 * 550 * 0.2, 6);
    expect(draft.total).toBeCloseTo(22 * 550 * 1.2, 6);
  });

  it('derives due_date from payment_terms_days', () => {
    // payment_terms_days = 30 for dcSowRow
    expect(draft.due_date).toBe('2026-05-20');
  });

  it('defaults mechanism / status / pdf_path for a fresh draft', () => {
    expect(draft.mechanism).toBe('supplier-issued');
    expect(draft.status).toBe('draft');
    expect(draft.pdf_path).toBeNull();
  });

  it('composes description from the contract job_title', () => {
    expect(draft.description).toBe('David Morrison - Consultant Services, Senior Engineer');
  });
});

describe('buildDraftInvoice — resolveNextPeriodStart integration', () => {
  it('continues from period_end + 1 of the latest non-draft invoice on the same contract', () => {
    // Retag the fixture rows so they belong to `dc.id` (test-helpers
    // invoices target an older contract id by default).
    const existing = [dcInvoice001, dcInvoice002]
      .map(row => parseInvoiceRow({ ...row, contract_id: dc.id }));
    // latest non-draft = DC-002, period_end = 2025-07-29 → start 2025-07-30,
    // clamped forward to contract.start_date = 2026-03-02.
    const draft = buildDraftInvoice({
      contract: dc,
      client: deltaCapita,
      company: ukLtd,
      leaveRows: [],
      existingInvoices: existing,
      today: '2026-04-20',
    });
    expect(draft.period_start).toBe('2026-03-02');
  });
});

describe('buildDraftInvoice — workload integration', () => {
  it('subtracts leave days from the billable count and subtotal', () => {
    const leaveRows: LeaveRow[] = [
      {
        id: 'leave-1',
        contract_id: dc.id,
        date: '2026-04-06',
        type: 'holiday',
        notes: null,
        external_logged: false,
        created_at: '2026-04-01',
        updated_at: '2026-04-01',
      },
      {
        id: 'leave-2',
        contract_id: dc.id,
        date: '2026-04-07',
        type: 'holiday',
        notes: null,
        external_logged: false,
        created_at: '2026-04-01',
        updated_at: '2026-04-01',
      },
    ];
    const draft = buildDraftInvoice({
      contract: dc,
      client: deltaCapita,
      company: ukLtd,
      leaveRows,
      existingInvoices: [],
      today: '2026-04-20',
    });
    expect(draft.days_billed).toBe(20);
    expect(draft.subtotal).toBe(20 * 550);
  });
});

describe('buildDraftInvoice — nextSupplierInvoiceId integration', () => {
  it('uses DC sequence for Delta Capita (FZ rows do not consume DC numbers)', () => {
    const existing = [dcInvoice001, dcInvoice002, fzcoInvoice001].map(parseInvoiceRow);
    const draft = buildDraftInvoice({
      contract: dc,
      client: deltaCapita,
      company: ukLtd,
      leaveRows: [],
      existingInvoices: existing,
      today: '2026-04-20',
    });
    expect(draft.id).toBe('DC-003');
    expect(draft.invoice_number).toBe('DC-003');
  });
});

describe('buildDraftInvoice — resolveInvoiceVatRate integration', () => {
  it('applies zero VAT for the UAE FZCO even on a GBP invoice', () => {
    // Re-use the DC contract structurally; the VAT decision is driven
    // entirely by the company's jurisdiction + vat_registered flag.
    const draft = buildDraftInvoice({
      contract: dc,
      client: laFosse,
      company: fzco,
      leaveRows: [],
      existingInvoices: [],
      today: '2026-04-20',
    });
    expect(draft.vat_rate).toBe(0);
    expect(draft.vat_amount).toBe(0);
    expect(draft.total).toBe(draft.subtotal);
    expect(draft.id).toBe('FZ-0001');
    expect(draft.invoice_number).toBe('FZ-0001');
  });
});

describe('buildDraftInvoice — contract end_date clamp', () => {
  it('ends the period on contract.end_date when it falls inside the calendar month', () => {
    const shortened = parseContractRow({
      ...dcSowRow,
      end_date: '2026-04-15',
    });
    const draft = buildDraftInvoice({
      contract: shortened,
      client: deltaCapita,
      company: ukLtd,
      leaveRows: [],
      existingInvoices: [],
      today: '2026-04-20',
    });
    expect(draft.period_end).toBe('2026-04-15');
  });
});
