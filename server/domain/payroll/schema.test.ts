import { describe, it, expect } from 'vitest';
import { DirectorPayrollSchema } from './schema.js';
import { buildPayrollRegistry } from './registry.js';

describe('DirectorPayrollSchema validation', () => {
  it('accepts a well-formed hydrated record', () => {
    const result = DirectorPayrollSchema.safeParse({
      personId: 'david',
      monthlySalary: 758,
      tolerance: 10,
      namePattern: '%DAVID MORRISON%',
      label: "David's Tax",
      code: 'DA',
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative tolerance', () => {
    const result = DirectorPayrollSchema.safeParse({
      personId: 'david',
      monthlySalary: 758,
      tolerance: -1,
      namePattern: '%DAVID%',
      label: "David's Tax",
      code: 'DA',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty string fields', () => {
    const result = DirectorPayrollSchema.safeParse({
      personId: 'david',
      monthlySalary: 758,
      tolerance: 10,
      namePattern: '',
      label: '',
      code: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown personId', () => {
    const result = DirectorPayrollSchema.safeParse({
      personId: 'Martha',
      monthlySalary: 758,
      tolerance: 10,
      namePattern: '%MARTHA%',
      label: "Martha's Tax",
      code: 'MA',
    });
    expect(result.success).toBe(false);
  });
});

describe('schema coherence with live registry', () => {
  it('every director in the live registry parses against DirectorPayrollSchema', () => {
    const reg = buildPayrollRegistry();
    for (const [personId, record] of reg.indexes.directorsById) {
      const parsed = DirectorPayrollSchema.safeParse(record);
      if (!parsed.success) {
        throw new Error(
          `DirectorPayroll for ${personId} failed schema: ${JSON.stringify(
            parsed.error.issues,
            null,
            2,
          )}`,
        );
      }
    }
  });
});
