import { describe, it, expect } from 'vitest';
import { MovementSchema } from './movements-schema.js';

describe('MovementSchema', () => {
  const valid = {
    id: 'plan-a-monthly-1',
    plan_id: 'plan-a',
    from_account: 'natwest' as const,
    to_account: 'barclays-current' as const,
    amount: 400,
    day_of_month: 1,
    expected_start_date: '2026-05-01',
    expected_end_date: '2027-05-01',
    acknowledged_at: null,
    dismissed_missed_until: null,
    updated_at: '2026-04-25',
  };

  it('accepts a valid movement', () => {
    expect(() => MovementSchema.parse(valid)).not.toThrow();
  });

  it('rejects amount <= 0', () => {
    expect(() => MovementSchema.parse({ ...valid, amount: 0 })).toThrow();
    expect(() => MovementSchema.parse({ ...valid, amount: -1 })).toThrow();
  });

  it('rejects day_of_month < 1 or > 28', () => {
    expect(() => MovementSchema.parse({ ...valid, day_of_month: 0 })).toThrow();
    expect(() => MovementSchema.parse({ ...valid, day_of_month: 29 })).toThrow();
    expect(() => MovementSchema.parse({ ...valid, day_of_month: 31 })).toThrow();
  });

  it('rejects non-integer day_of_month', () => {
    expect(() => MovementSchema.parse({ ...valid, day_of_month: 5.5 })).toThrow();
  });

  it('accepts null acknowledged_at, dismissed_missed_until, expected_end_date', () => {
    expect(() =>
      MovementSchema.parse({
        ...valid,
        acknowledged_at: null,
        dismissed_missed_until: null,
        expected_end_date: null,
      }),
    ).not.toThrow();
  });

  it('rejects malformed dates', () => {
    expect(() =>
      MovementSchema.parse({ ...valid, expected_start_date: '01/05/2026' }),
    ).toThrow();
    expect(() =>
      MovementSchema.parse({ ...valid, acknowledged_at: 'yesterday' }),
    ).toThrow();
  });
});
