import { describe, it, expect } from 'vitest';
import type { Contract, Invoice } from '../../../shared/api-contracts.js';
import { getPublicHolidays } from '../working-days/public-holidays.js';
import { computeImpliedLeave } from './implied-leave-seed.js';

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

const NOW = '2026-04-25';

function ukHolidayDatesForYear(year: number): ReadonlySet<string> {
  return new Set(
    getPublicHolidays('UK', year).map(h => h.date),
  );
}

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

function makeInvoice(overrides: Partial<Invoice> & { id: string; period_start: string; days_billed: number }): Invoice {
  return {
    contract_id: 'dc-sow-2026',
    client_id: 'delta-capita',
    issuing_entity_id: 'autonize-it-ltd',
    invoice_number: overrides.id,
    payment_reference: overrides.id,
    invoice_date: '2025-07-09',
    period_end: '2025-06-30',
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
    due_date: '2025-08-09',
    created_at: '2025-07-09',
    updated_at: null,
    ...overrides,
  };
}

describe('computeImpliedLeave', () => {
  it('returns 0 rows when billed matches expected (Aug 2025, 20 days)', () => {
    const holidays = ukHolidayDatesForYear(2025);
    const result = computeImpliedLeave({
      invoice: makeInvoice({ id: 'DC-003', period_start: '2025-08-01', period_end: '2025-08-29', days_billed: 20 }),
      contract: DC_CONTRACT,
      publicHolidayDates: holidays,
      now: NOW,
    });
    expect(result).toHaveLength(0);
  });

  it('generates 4 leave rows for Jul 2025 (23 expected, 19 billed)', () => {
    const holidays = ukHolidayDates('2025-07-01', '2025-07-31');
    const result = computeImpliedLeave({
      invoice: makeInvoice({ id: 'DC-002', period_start: '2025-07-01', period_end: '2025-07-29', days_billed: 19 }),
      contract: DC_CONTRACT,
      publicHolidayDates: holidays,
      now: NOW,
    });
    expect(result).toHaveLength(4);
    for (const row of result) {
      expect(row.contract_id).toBe('dc-sow-2026');
      expect(row.type).toBe('holiday');
      expect(row.notes).toBe('Implied from invoice DC-002');
      expect(row.date.startsWith('2025-07-')).toBe(true);
    }
  });

  it('generates 5 leave rows for Mar 2026', () => {
    const holidays = ukHolidayDates('2026-03-01', '2026-03-31');
    const result = computeImpliedLeave({
      invoice: makeInvoice({ id: 'DC-010', period_start: '2026-03-01', period_end: '2026-03-31', days_billed: 17 }),
      contract: DC_CONTRACT,
      publicHolidayDates: holidays,
      now: NOW,
    });
    expect(result).toHaveLength(5);
    const dates = result.map(r => r.date);
    expect(dates).toEqual([...dates].sort());
  });

  it('picks the last N working days in the month for leave dates', () => {
    const holidays = ukHolidayDates('2025-09-01', '2025-09-30');
    const result = computeImpliedLeave({
      invoice: makeInvoice({ id: 'DC-004', period_start: '2025-09-01', period_end: '2025-09-30', days_billed: 20 }),
      contract: DC_CONTRACT,
      publicHolidayDates: holidays,
      now: NOW,
    });
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2025-09-29');
    expect(result[1].date).toBe('2025-09-30');
  });

  it('roadmap table totals: 9 months produce exactly 17 leave rows', () => {
    const invoices = [
      makeInvoice({ id: 'DC-002', period_start: '2025-07-01', period_end: '2025-07-29', days_billed: 19 }),
      makeInvoice({ id: 'DC-003', period_start: '2025-08-01', period_end: '2025-08-29', days_billed: 20 }),
      makeInvoice({ id: 'DC-004', period_start: '2025-09-01', period_end: '2025-09-30', days_billed: 20 }),
      makeInvoice({ id: 'DC-005', period_start: '2025-10-01', period_end: '2025-10-31', days_billed: 20 }),
      makeInvoice({ id: 'DC-006', period_start: '2025-11-01', period_end: '2025-11-30', days_billed: 18 }),
      makeInvoice({ id: 'DC-007', period_start: '2025-12-01', period_end: '2025-12-31', days_billed: 21 }),
      makeInvoice({ id: 'DC-008', period_start: '2026-01-01', period_end: '2026-01-30', days_billed: 20 }),
      makeInvoice({ id: 'DC-009', period_start: '2026-02-01', period_end: '2026-02-28', days_billed: 20 }),
      makeInvoice({ id: 'DC-010', period_start: '2026-03-01', period_end: '2026-03-31', days_billed: 17 }),
    ];
    const holidays = ukHolidayDates('2025-01-01', '2026-12-31');
    const all = invoices.flatMap(invoice =>
      computeImpliedLeave({ invoice, contract: DC_CONTRACT, publicHolidayDates: holidays, now: NOW }),
    );
    expect(all).toHaveLength(17);

    const perMonth = new Map<string, number>();
    for (const row of all) {
      const month = row.date.slice(0, 7);
      perMonth.set(month, (perMonth.get(month) ?? 0) + 1);
    }
    expect(perMonth.get('2025-07')).toBe(4);
    expect(perMonth.has('2025-08')).toBe(false);
    expect(perMonth.get('2025-09')).toBe(2);
    expect(perMonth.get('2025-10')).toBe(3);
    expect(perMonth.get('2025-11')).toBe(2);
    expect(perMonth.has('2025-12')).toBe(false);
    expect(perMonth.get('2026-01')).toBe(1);
    expect(perMonth.has('2026-02')).toBe(false);
    expect(perMonth.get('2026-03')).toBe(5);
  });
});
