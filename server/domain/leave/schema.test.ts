/**
 * Schema round-trip tests for the leave domain.
 */

import { describe, it, expect } from 'vitest';
import {
  LeaveRowSchema,
  LeaveTypeSchema,
  LeaveRequestSchema,
} from './schema.js';

describe('LeaveTypeSchema', () => {
  it('accepts holiday and sick', () => {
    expect(LeaveTypeSchema.parse('holiday')).toBe('holiday');
    expect(LeaveTypeSchema.parse('sick')).toBe('sick');
  });

  it('rejects every value that used to exist pre-trim', () => {
    for (const v of ['unpaid', 'company-closure', 'bank-holiday', 'public-holiday', '', 'paid']) {
      expect(LeaveTypeSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe('LeaveRowSchema', () => {
  const valid = {
    id: 'dc-sow-2026-2026-05-04',
    contract_id: 'dc-sow-2026',
    date: '2026-05-04',
    type: 'holiday' as const,
    notes: null,
    external_logged: false,
    created_at: '2026-04-20',
    updated_at: '2026-04-20',
  };

  it('round-trips a valid row', () => {
    expect(LeaveRowSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a date that is not yyyy-mm-dd', () => {
    expect(LeaveRowSchema.safeParse({ ...valid, date: '04/05/2026' }).success).toBe(false);
  });

  it('has no `paid` column — unknown keys are dropped silently but `paid` is not inferred', () => {
    const parsed = LeaveRowSchema.parse({ ...valid, paid: true });
    expect('paid' in parsed).toBe(false);
  });

  it('rejects an invalid type', () => {
    expect(LeaveRowSchema.safeParse({ ...valid, type: 'unpaid' }).success).toBe(false);
  });
});

describe('LeaveRequestSchema', () => {
  it('requires at least one date', () => {
    expect(
      LeaveRequestSchema.safeParse({ dates: [], type: 'holiday' }).success,
    ).toBe(false);
  });

  it('accepts an optional notes field', () => {
    const parsed = LeaveRequestSchema.parse({
      dates: ['2026-05-04'],
      type: 'holiday',
      notes: 'Long weekend',
    });
    expect(parsed.notes).toBe('Long weekend');
  });

  it('treats notes as optional — missing is allowed', () => {
    const parsed = LeaveRequestSchema.parse({ dates: ['2026-05-04'], type: 'sick' });
    expect(parsed.notes).toBeUndefined();
  });
});
