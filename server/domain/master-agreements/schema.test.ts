/**
 * Zod-level invariants for MasterAgreement.
 */

import { describe, it, expect } from 'vitest';
import { MasterAgreementSchema } from './schema.js';

const base = {
  id: 'dc-master-2025',
  client_id: 'delta-capita',
  reference: 'CONTRACTOR-FRAMEWORK-2025',
  start_date: '2025-11-03',
  end_date: null,
  company_notice_weeks: 1,
  supplier_notice_weeks: 1,
  jurisdiction: 'England',
  signed_at: '2025-11-03',
  docusign_envelope: null,
  active: true,
  updated_at: '2026-04-21',
};

describe('MasterAgreementSchema', () => {
  it('accepts a minimal valid row', () => {
    expect(MasterAgreementSchema.parse(base).id).toBe('dc-master-2025');
  });

  it('allows end_date to be null (open-ended)', () => {
    expect(MasterAgreementSchema.parse({ ...base, end_date: null }).end_date).toBeNull();
  });

  it('allows end_date to be an ISO date', () => {
    const parsed = MasterAgreementSchema.parse({ ...base, end_date: '2027-12-31' });
    expect(parsed.end_date).toBe('2027-12-31');
  });

  it('rejects a malformed id', () => {
    expect(() => MasterAgreementSchema.parse({ ...base, id: 'BAD_ID' })).toThrow();
  });

  it('rejects a negative notice period', () => {
    expect(() =>
      MasterAgreementSchema.parse({ ...base, company_notice_weeks: -1 }),
    ).toThrow();
  });

  it('rejects non-ISO dates', () => {
    expect(() => MasterAgreementSchema.parse({ ...base, start_date: '03/11/2025' })).toThrow();
  });
});
