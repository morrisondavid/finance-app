import { describe, it, expect } from 'vitest';
import type { Contract, Invoice, LeaveRow } from '../../../shared/api-contracts.js';
import { getPublicHolidays } from '../working-days/public-holidays.js';
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
  active: true,
  updated_at: '2026-04-24',
};

const contractsById = new Map([[DC_CONTRACT.id, DC_CONTRACT]]);

function ukHolidayDates(start: string, end: string): ReadonlySet<string> {
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  const dates = new Set<string>();
  for (let y = startYear; y <= endYear; y++) {
    for (const h of getPublicHolidays('UK', y)) {
      if (h.date >= start && h.date <= end) dates.add(h.date);
    }
  }
  return dates;
}

const publicHolidayDatesByEntity = new Map([
  ['autonize-it-ltd', ukHolidayDates('2025-01-01', '2027-12-31')],
]);

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
    pdf_path: null,
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
      publicHolidayDatesByEntity,
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
      publicHolidayDatesByEntity,
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
      publicHolidayDatesByEntity,
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
      publicHolidayDatesByEntity,
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
      publicHolidayDatesByEntity,
    });
    expect(result).toHaveLength(0);
  });
});
