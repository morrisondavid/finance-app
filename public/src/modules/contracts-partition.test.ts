/**
 * Pure-function tests for the contracts-tab partitioning helpers.
 *
 * `partitionContracts` + `isEnded` + `daysUntilEnd` are the predicates
 * behind the ended-contract panel and the "Ends in Nd" tile badge.
 * Keeping them pure means we can lock the boundaries (strict `<`,
 * open-ended `null`, overdue negative) without spinning up the DOM.
 */

import { describe, it, expect } from 'vitest';
import {
  daysUntilEnd,
  isEnded,
  partitionContracts,
} from './contracts';
import type { Contract } from '../../../shared/api-contracts.js';

function contract(overrides: Partial<Contract> & { id: string; end_date: string | null }): Contract {
  const base: Contract = {
    id: overrides.id,
    client_id: 'la-fosse',
    issuing_entity_id: 'autonize-it-ltd',
    master_id: null,
    reference: 'REF',
    start_date: '2026-01-01',
    end_date: overrides.end_date,
    works_monday: true,
    works_tuesday: true,
    works_wednesday: true,
    works_thursday: true,
    works_friday: true,
    works_saturday: false,
    works_sunday: false,
    day_rate: 500,
    day_rate_currency: 'GBP',
    invoice_currency: 'GBP',
    invoice_cadence: 'weekly',
    invoice_mechanism: 'self-bill',
    payment_terms_days: 14,
    company_notice_weeks: 1,
    supplier_notice_weeks: 1,
    renewal_warning_days: 30,
    job_title: 'Engineer',
    job_description: null,
    work_location: 'Remote',
    conduct_regs: null,
    engagement_tax_status: null,
    jurisdiction: 'England',
    signed_at: '2025-12-20',
    docusign_envelope: null,
    active: true,
    updated_at: '2026-04-24',
  };
  return { ...base, ...overrides };
}

describe('isEnded', () => {
  it('returns false for open-ended contracts', () => {
    expect(isEnded(contract({ id: 'a', end_date: null }), '2030-01-01')).toBe(false);
  });

  it('returns false on the exact end date (strict <)', () => {
    expect(isEnded(contract({ id: 'a', end_date: '2026-04-24' }), '2026-04-24')).toBe(false);
  });

  it('returns true the day after the end date', () => {
    expect(isEnded(contract({ id: 'a', end_date: '2026-04-24' }), '2026-04-25')).toBe(true);
  });
});

describe('daysUntilEnd', () => {
  it('returns null for open-ended contracts', () => {
    expect(daysUntilEnd(contract({ id: 'a', end_date: null }), '2026-04-24')).toBeNull();
  });

  it('returns 0 on the end date itself', () => {
    expect(daysUntilEnd(contract({ id: 'a', end_date: '2026-04-24' }), '2026-04-24')).toBe(0);
  });

  it('returns a positive count for a future end date', () => {
    expect(daysUntilEnd(contract({ id: 'a', end_date: '2026-04-30' }), '2026-04-24')).toBe(6);
  });

  it('returns a negative count for an overdue end date', () => {
    expect(daysUntilEnd(contract({ id: 'a', end_date: '2026-04-20' }), '2026-04-24')).toBe(-4);
  });
});

describe('partitionContracts', () => {
  const activeContract = contract({ id: 'active', end_date: '2026-06-30' });
  const endedContract = contract({ id: 'ended', end_date: '2026-03-01' });
  const openEnded = contract({ id: 'open', end_date: null });
  const today = '2026-04-24';

  it('splits an active and an ended contract correctly', () => {
    const { active, ended } = partitionContracts([activeContract, endedContract], today);
    expect(active.map(c => c.id)).toEqual(['active']);
    expect(ended.map(c => c.id)).toEqual(['ended']);
  });

  it('sorts open-ended contracts into active', () => {
    const { active, ended } = partitionContracts([openEnded], today);
    expect(active.map(c => c.id)).toEqual(['open']);
    expect(ended).toEqual([]);
  });

  it('keeps a contract ending exactly today in active (strict <)', () => {
    const boundary = contract({ id: 'boundary', end_date: today });
    const { active, ended } = partitionContracts([boundary], today);
    expect(active.map(c => c.id)).toEqual(['boundary']);
    expect(ended).toEqual([]);
  });

  it('preserves input order within each bucket', () => {
    const a = contract({ id: 'a', end_date: '2026-06-30' });
    const b = contract({ id: 'b', end_date: '2026-03-01' });
    const c = contract({ id: 'c', end_date: '2026-07-01' });
    const d = contract({ id: 'd', end_date: '2026-02-01' });
    const { active, ended } = partitionContracts([a, b, c, d], today);
    expect(active.map(x => x.id)).toEqual(['a', 'c']);
    expect(ended.map(x => x.id)).toEqual(['b', 'd']);
  });
});
