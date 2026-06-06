import { describe, it, expect } from 'vitest';
import type { Contract, Invoice, LeaveRow } from '../../../shared/api-contracts.js';
import { deriveInvoiceDaysMismatchWarnings } from './invoice-days-mismatch.js';

const DC_CONTRACT: Contract = {
  id: 'dc-sow-2026',
  client_id: 'delta-capita',
  issuing_entity_id: 'autonize-it-ltd',
  master_id: 'dc-master-2025',
  reference: 'Delta Capita · 23 Jun 2025–30 Apr 2026',
  placement_ref: null,
  start_date: '2025-06-23',
  end_date: '2026-04-30',
  works_monday: true,
  works_tuesday: true,
  works_wednesday: true,
  works_thursday: true,
  works_friday: true,
  works_saturday: false,
  works_sunday: false,
  day_rate: 550,
  day_rate_currency: 'GBP',
  invoice_currency: 'GBP',
  invoice_cadence: 'monthly',
  invoice_mechanism: 'supplier-issued',
  payment_terms_days: 30,
  company_notice_weeks: 4,
  supplier_notice_weeks: 4,
  renewal_warning_days: 60,
  job_title: 'Full Stack Developer',
  job_description: null,
  work_location: 'Remote / London',
  conduct_regs: 'opted-out',
  engagement_tax_status: 'outside-ir35',
  jurisdiction: 'England',
  signed_at: '2025-12-22',
  docusign_envelope: null,
  updated_at: '2026-04-24',
};

const contractsById = new Map([[DC_CONTRACT.id, DC_CONTRACT]]);

function makeInvoice(overrides: Partial<Invoice> & { id: string; period_start: string; days_billed: number }): Invoice {
  return {
    contract_id: 'dc-sow-2026',
    client_id: 'delta-capita',
    issuing_entity_id: 'autonize-it-ltd',
    invoice_number: overrides.id,
    payment_reference: overrides.id,
    invoice_date: '2025-09-24',
    period_end: '2025-09-30',
    description: 'test',
    currency: 'GBP',
    subtotal: 0,
    vat_rate: 0.2,
    vat_amount: 0,
    total: 0,
    fx_rate_at_issue: null,
    fx_base_currency: null,
    mechanism: 'supplier-issued',
    status: 'paid',
    due_date: '2025-10-24',
    created_at: '2025-09-24',
    updated_at: null,
    ...overrides,
  };
}

function leaveRow(date: string): LeaveRow {
  return {
    id: `dc-sow-2026-${date}`,
    contract_id: 'dc-sow-2026',
    date,
    type: 'holiday',
    notes: null,
    external_logged: false,
    created_at: '2026-04-25',
    updated_at: '2026-04-25',
  };
}

describe('deriveInvoiceDaysMismatchWarnings', () => {
  it('emits no warning when billed matches ledger', () => {
    const invoice = makeInvoice({
      id: 'DC-004',
      period_start: '2025-09-01',
      period_end: '2025-09-30',
      days_billed: 20,
    });
    const leave = [leaveRow('2025-09-29'), leaveRow('2025-09-30')];
    const result = deriveInvoiceDaysMismatchWarnings({
      invoices: [invoice],
      contractsById,
      leaveRows: leave,
    });
    expect(result).toHaveLength(0);
  });

  it('emits a warning when billed differs from ledger', () => {
    const invoice = makeInvoice({
      id: 'DC-004',
      period_start: '2025-09-01',
      period_end: '2025-09-30',
      days_billed: 20,
    });
    const result = deriveInvoiceDaysMismatchWarnings({
      invoices: [invoice],
      contractsById,
      leaveRows: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('invoice-days-mismatch');
    expect(result[0].title).toContain('DC-004');
    expect(result[0].title).toContain('20');
    expect(result[0].title).toContain('22');
  });

  it('skips invoices with reversed periods', () => {
    const invoice = makeInvoice({
      id: 'DC-BAD',
      period_start: '2025-12-30',
      period_end: '2025-01-05',
      days_billed: 20,
    });
    const result = deriveInvoiceDaysMismatchWarnings({
      invoices: [invoice],
      contractsById,
      leaveRows: [],
    });
    expect(result).toHaveLength(0);
  });

  it('skips invoices for unknown contracts', () => {
    const invoice = makeInvoice({
      id: 'DC-UNK',
      period_start: '2025-09-01',
      period_end: '2025-09-30',
      days_billed: 20,
      contract_id: 'nonexistent',
    });
    const result = deriveInvoiceDaysMismatchWarnings({
      invoices: [invoice],
      contractsById,
      leaveRows: [],
    });
    expect(result).toHaveLength(0);
  });

  it('emits no warning for partial first-month invoice (DC-001 style)', () => {
    const invoice = makeInvoice({
      id: 'DC-001',
      period_start: '2025-06-23',
      period_end: '2025-06-30',
      days_billed: 6,
      contract_id: 'dc-sow-2025-jun',
    });
    const contract: Contract = {
      ...DC_CONTRACT,
      id: 'dc-sow-2025-jun',
      reference: 'Delta Capita · 23 Jun 2025–31 Dec 2025',
      start_date: '2025-06-23',
      end_date: '2025-12-31',
    };
    const result = deriveInvoiceDaysMismatchWarnings({
      invoices: [invoice],
      contractsById: new Map([[contract.id, contract]]),
      leaveRows: [],
    });
    expect(result).toHaveLength(0);
  });

  it('emits no warning for weekly La Fosse invoice spanning a month boundary', () => {
    const lfContract: Contract = {
      ...DC_CONTRACT,
      id: 'lf-bh25537',
      client_id: 'la-fosse',
      reference: 'La Fosse · 18 Feb 2025–28 Sep 2025',
      start_date: '2025-02-18',
      end_date: '2025-09-28',
      invoice_cadence: 'weekly',
      invoice_mechanism: 'self-bill',
      day_rate: 600,
    };
    const invoice = makeInvoice({
      id: 'EG-0007',
      client_id: 'la-fosse',
      contract_id: 'lf-bh25537',
      mechanism: 'self-bill',
      period_start: '2025-03-31',
      period_end: '2025-04-06',
      days_billed: 5,
    });
    const result = deriveInvoiceDaysMismatchWarnings({
      invoices: [invoice],
      contractsById: new Map([[lfContract.id, lfContract]]),
      leaveRows: [],
    });
    expect(result).toHaveLength(0);
  });

  it('reconciles clean DC invoices with seed leave (no warnings)', () => {
    const cleanInvoices = [
      makeInvoice({ id: 'DC-003', period_start: '2025-08-01', period_end: '2025-08-29', days_billed: 20 }),
      makeInvoice({ id: 'DC-004', period_start: '2025-09-01', period_end: '2025-09-30', days_billed: 20 }),
      makeInvoice({ id: 'DC-007', period_start: '2025-12-01', period_end: '2025-12-31', days_billed: 21 }),
      makeInvoice({ id: 'DC-009', period_start: '2026-02-01', period_end: '2026-02-28', days_billed: 20 }),
    ];

    const seedLeave = [
      leaveRow('2025-09-29'), leaveRow('2025-09-30'),
    ];

    const result = deriveInvoiceDaysMismatchWarnings({
      invoices: cleanInvoices,
      contractsById,
      leaveRows: seedLeave,
    });
    expect(result).toHaveLength(0);
  });

  it('uses UK holidays for FZCO-issued England contracts (not UAE Eid)', () => {
    const fzContract: Contract = {
      ...DC_CONTRACT,
      id: 'lf-2026-apr',
      client_id: 'la-fosse',
      issuing_entity_id: 'autonize-it-fzco',
      reference: 'La Fosse · 02 Mar 2026–30 Apr 2026',
      start_date: '2026-03-02',
      end_date: '2026-04-30',
      invoice_cadence: 'weekly',
      invoice_mechanism: 'self-bill',
      day_rate: 500,
      jurisdiction: 'England',
    };
    const invoice = makeInvoice({
      id: 'EG-0054',
      client_id: 'la-fosse',
      contract_id: 'lf-2026-apr',
      issuing_entity_id: 'autonize-it-fzco',
      mechanism: 'self-bill',
      period_start: '2026-03-16',
      period_end: '2026-03-22',
      days_billed: 5,
    });
    const result = deriveInvoiceDaysMismatchWarnings({
      invoices: [invoice],
      contractsById: new Map([[fzContract.id, fzContract]]),
      leaveRows: [],
    });
    expect(result).toHaveLength(0);
  });
});
