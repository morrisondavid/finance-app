/**
 * Zod-level invariants for Contract.
 */

import { describe, it, expect } from 'vitest';
import { ContractSchema } from './schema.js';

const base = {
  id: 'dc-sow-2026',
  client_id: 'delta-capita',
  issuing_entity_id: 'autonize-it-ltd',
  master_id: 'dc-master-2025',
  reference: 'DMORRISON02',
  start_date: '2026-03-02',
  end_date: '2027-03-01',
  works_monday: true,
  works_tuesday: true,
  works_wednesday: true,
  works_thursday: true,
  works_friday: true,
  works_saturday: false,
  works_sunday: false,
  day_rate: 550,
  day_rate_currency: 'GBP' as const,
  invoice_currency: 'GBP' as const,
  invoice_cadence: 'monthly' as const,
  invoice_mechanism: 'supplier-issued' as const,
  payment_terms_days: 30,
  company_notice_weeks: 1,
  supplier_notice_weeks: 1,
  renewal_warning_days: 60,
  job_title: 'Senior Engineer',
  job_description: null,
  work_location: 'Remote / London',
  conduct_regs: 'opted-out' as const,
  engagement_tax_status: 'outside-ir35' as const,
  jurisdiction: 'England',
  signed_at: '2026-01-15',
  docusign_envelope: null,
  active: true,
  updated_at: '2026-04-21',
};

describe('ContractSchema', () => {
  it('accepts a minimal valid contract', () => {
    expect(ContractSchema.parse(base).id).toBe('dc-sow-2026');
  });

  it('allows master_id null (no umbrella agreement)', () => {
    const parsed = ContractSchema.parse({ ...base, master_id: null });
    expect(parsed.master_id).toBeNull();
  });

  it('allows conduct_regs null (non-UK / not applicable)', () => {
    const parsed = ContractSchema.parse({ ...base, conduct_regs: null });
    expect(parsed.conduct_regs).toBeNull();
  });

  it('allows end_date null (open-ended contract)', () => {
    const parsed = ContractSchema.parse({ ...base, end_date: null });
    expect(parsed.end_date).toBeNull();
  });

  it('rejects negative day_rate', () => {
    expect(() => ContractSchema.parse({ ...base, day_rate: -1 })).toThrow();
  });

  it('rejects non-ISO start_date', () => {
    expect(() => ContractSchema.parse({ ...base, start_date: '02/03/2026' })).toThrow();
  });

  it('rejects invalid invoice_cadence', () => {
    expect(() => ContractSchema.parse({ ...base, invoice_cadence: 'quarterly' })).toThrow();
  });
});
