import { describe, it, expect } from 'vitest';
import {
  LeaveTypeSchema,
  TemplateConsultantSchema,
  TemplateLeaveSchema,
  TemplateContextSchema,
  TemplateResultSchema,
  TemplateKindSchema,
} from './schema.js';
import { makeDeltaCapitaFixtureClient, makeDcContractFixture } from './test-helpers.js';

describe('LeaveTypeSchema', () => {
  it('accepts the two records-only values', () => {
    expect(LeaveTypeSchema.parse('holiday')).toBe('holiday');
    expect(LeaveTypeSchema.parse('sick')).toBe('sick');
  });

  it('rejects removed values like `unpaid` / `company-closure`', () => {
    expect(LeaveTypeSchema.safeParse('unpaid').success).toBe(false);
    expect(LeaveTypeSchema.safeParse('company-closure').success).toBe(false);
    expect(LeaveTypeSchema.safeParse('bank-holiday').success).toBe(false);
    expect(LeaveTypeSchema.safeParse('public-holiday').success).toBe(false);
  });
});

describe('TemplateKindSchema', () => {
  it('accepts every canonical kind', () => {
    for (const k of ['leave', 'sickness', 'invoice-cover', 'renewal', 'timesheet']) {
      expect(TemplateKindSchema.parse(k)).toBe(k);
    }
  });

  it('rejects unknown kinds', () => {
    expect(TemplateKindSchema.safeParse('onboarding').success).toBe(false);
  });
});

describe('TemplateConsultantSchema', () => {
  it('requires non-empty name + email', () => {
    expect(
      TemplateConsultantSchema.parse({ name: 'David Morrison', email: 'david@autonize-it.com' }),
    ).toEqual({ name: 'David Morrison', email: 'david@autonize-it.com' });
  });

  it('rejects empty strings on either field', () => {
    expect(TemplateConsultantSchema.safeParse({ name: '', email: 'x' }).success).toBe(false);
    expect(TemplateConsultantSchema.safeParse({ name: 'x', email: '' }).success).toBe(false);
  });
});

describe('TemplateLeaveSchema', () => {
  it('accepts a non-empty date list + holiday/sick type', () => {
    expect(
      TemplateLeaveSchema.parse({
        dates: ['2026-05-04', '2026-05-05'],
        range_label: 'Mon 04 May 2026 – Tue 05 May 2026',
        type: 'holiday',
      }),
    ).toBeDefined();
  });

  it('rejects an empty dates array', () => {
    expect(
      TemplateLeaveSchema.safeParse({ dates: [], range_label: 'x', type: 'holiday' }).success,
    ).toBe(false);
  });

  it('rejects a non-ISO date in the dates list', () => {
    expect(
      TemplateLeaveSchema.safeParse({
        dates: ['2026/05/04'],
        range_label: 'x',
        type: 'holiday',
      }).success,
    ).toBe(false);
  });
});

describe('TemplateContextSchema', () => {
  const today = '2026-04-22';
  const client = makeDeltaCapitaFixtureClient();
  const contract = makeDcContractFixture();

  it('round-trips a valid context with null leave', () => {
    const ctx = {
      client,
      contract,
      consultant: { name: 'David', email: 'david@autonize-it.com' },
      recipient_name: 'Lily Lovegrove-Saville',
      leave: null,
      today,
    };
    expect(TemplateContextSchema.parse(ctx)).toEqual(ctx);
  });

  it('round-trips a valid context with a leave block', () => {
    const leave = {
      dates: ['2026-05-04'],
      range_label: 'Mon 04 May 2026',
      type: 'holiday' as const,
    };
    const parsed = TemplateContextSchema.parse({
      client,
      contract,
      consultant: { name: 'David', email: 'david@autonize-it.com' },
      recipient_name: 'Lily Lovegrove-Saville',
      leave,
      today,
    });
    expect(parsed.leave).toEqual(leave);
  });

  it('rejects an empty recipient_name', () => {
    const base = {
      client,
      contract,
      consultant: { name: 'D', email: 'd@x' },
      leave: null,
      today,
    };
    expect(
      TemplateContextSchema.safeParse({ ...base, recipient_name: '' }).success,
    ).toBe(false);
  });
});

describe('TemplateResultSchema', () => {
  it('accepts a valid subject + body + recipients envelope', () => {
    const result = {
      subject: 'Planned leave',
      body: 'Hi, I will be out on Mon 04 May 2026.',
      recipients: { to: ['lily@x'], cc: ['hr@x'] },
    };
    expect(TemplateResultSchema.parse(result)).toEqual(result);
  });

  it('rejects an empty subject or body', () => {
    expect(
      TemplateResultSchema.safeParse({ subject: '', body: 'x', recipients: { to: [], cc: [] } }).success,
    ).toBe(false);
    expect(
      TemplateResultSchema.safeParse({ subject: 'x', body: '', recipients: { to: [], cc: [] } }).success,
    ).toBe(false);
  });
});
