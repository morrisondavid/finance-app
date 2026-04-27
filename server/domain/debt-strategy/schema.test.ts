import { describe, it, expect } from 'vitest';
import {
  PlanSchema,
  PlanGoalTypeSchema,
  PlanIntensitySchema,
  PlanPersistedStatusSchema,
  PlanScopeSchema,
} from './schema.js';

describe('PlanSchema', () => {
  const valid = {
    id: 'clear-funding-circle',
    display_name: 'Clear Funding Circle',
    goal_type: 'pay-off-debt' as const,
    target_id: 'funding-circle',
    target_amount: null,
    target_account: 'barclays-current' as const,
    target_date_or_asap: 'ASAP',
    currency: 'GBP' as const,
    scope: 'autonize-it-ltd' as const,
    intensity: 'medium' as const,
    monthly_allocation: 400,
    status: 'active' as const,
    activated_at: '2026-04-25',
    completed_at: null,
    projected_completion_date: '2027-01-15',
    notes: null,
    updated_at: '2026-04-25',
  };

  it('accepts a valid pay-off-debt plan', () => {
    expect(() => PlanSchema.parse(valid)).not.toThrow();
  });

  it('accepts a valid save-for-target plan', () => {
    expect(() =>
      PlanSchema.parse({
        ...valid,
        id: 'holiday-fund-q3',
        display_name: 'Holiday Fund Q3',
        goal_type: 'save-for-target',
        target_id: null,
        target_amount: 8000,
        target_account: 'natwest-savings',
        target_date_or_asap: '2026-07-01',
        scope: 'household',
      }),
    ).not.toThrow();
  });

  it('rejects an unknown goal_type', () => {
    expect(() => PlanSchema.parse({ ...valid, goal_type: 'random' })).toThrow();
  });

  it('rejects an unknown intensity', () => {
    expect(() => PlanSchema.parse({ ...valid, intensity: 'extreme' })).toThrow();
  });

  it('rejects suggested as a persisted status (must be active|paused|completed)', () => {
    expect(() => PlanSchema.parse({ ...valid, status: 'suggested' })).toThrow();
  });

  it('rejects target_amount <= 0 when present', () => {
    expect(() => PlanSchema.parse({ ...valid, target_amount: 0 })).toThrow();
    expect(() => PlanSchema.parse({ ...valid, target_amount: -100 })).toThrow();
  });

  it('rejects monthly_allocation <= 0', () => {
    expect(() => PlanSchema.parse({ ...valid, monthly_allocation: 0 })).toThrow();
    expect(() => PlanSchema.parse({ ...valid, monthly_allocation: -1 })).toThrow();
  });

  it('rejects bad target_date_or_asap formats', () => {
    expect(() => PlanSchema.parse({ ...valid, target_date_or_asap: 'soon' })).toThrow();
    expect(() => PlanSchema.parse({ ...valid, target_date_or_asap: '2026/04/25' })).toThrow();
  });

  it('accepts ASAP for target_date_or_asap', () => {
    expect(() => PlanSchema.parse({ ...valid, target_date_or_asap: 'ASAP' })).not.toThrow();
  });

  it('accepts ISO date for target_date_or_asap', () => {
    expect(() => PlanSchema.parse({ ...valid, target_date_or_asap: '2027-12-31' })).not.toThrow();
  });

  it('rejects non-kebab id', () => {
    expect(() => PlanSchema.parse({ ...valid, id: 'NotKebab' })).toThrow();
    expect(() => PlanSchema.parse({ ...valid, id: '_underscore-lead' })).toThrow();
  });
});

describe('enum schemas accept the documented values', () => {
  it('PlanGoalTypeSchema', () => {
    expect(PlanGoalTypeSchema.parse('pay-off-debt')).toBe('pay-off-debt');
    expect(PlanGoalTypeSchema.parse('save-for-target')).toBe('save-for-target');
  });

  it('PlanIntensitySchema', () => {
    expect(PlanIntensitySchema.parse('aggressive')).toBe('aggressive');
    expect(PlanIntensitySchema.parse('medium')).toBe('medium');
    expect(PlanIntensitySchema.parse('passive')).toBe('passive');
  });

  it('PlanPersistedStatusSchema rejects suggested', () => {
    expect(() => PlanPersistedStatusSchema.parse('suggested')).toThrow();
    expect(PlanPersistedStatusSchema.parse('active')).toBe('active');
    expect(PlanPersistedStatusSchema.parse('paused')).toBe('paused');
    expect(PlanPersistedStatusSchema.parse('completed')).toBe('completed');
  });

  it('PlanScopeSchema accepts household and entity ids', () => {
    expect(PlanScopeSchema.parse('household')).toBe('household');
    expect(PlanScopeSchema.parse('autonize-it-ltd')).toBe('autonize-it-ltd');
    expect(PlanScopeSchema.parse('autonize-it-fzco')).toBe('autonize-it-fzco');
    expect(() => PlanScopeSchema.parse('random-entity')).toThrow();
  });
});
