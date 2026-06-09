import { describe, it, expect } from 'vitest';
import { PropertySchema } from './schema.js';

describe('PropertySchema', () => {
  it('accepts a valid row', () => {
    const valid = {
      id: 'hunters-square-78',
      address: '78 Hunters Square, London',
      ownership_david: 0.5,
      ownership_heena: 0.5,
      notes: 'Buy-to-let',
      status: 'let',
      sold_at: null,
      updated_at: '2026-04-25',
    };
    expect(() => PropertySchema.parse(valid)).not.toThrow();
  });

  it('rejects a non-kebab-case id', () => {
    expect(() =>
      PropertySchema.parse({
        id: '78_hunters_square',
        address: '78 Hunters Square',
        ownership_david: 0.5,
        ownership_heena: 0.5,
        notes: null,
        updated_at: '2026-04-25',
      }),
    ).toThrow();
  });

  it('rejects ownership shares outside [0, 1]', () => {
    expect(() =>
      PropertySchema.parse({
        id: 'p',
        address: '1 Address',
        ownership_david: 1.2,
        ownership_heena: -0.2,
        notes: null,
        updated_at: '2026-04-25',
      }),
    ).toThrow();
  });

  it('rejects a non-ISO updated_at', () => {
    expect(() =>
      PropertySchema.parse({
        id: 'p',
        address: '1 Address',
        ownership_david: 0.5,
        ownership_heena: 0.5,
        notes: null,
        updated_at: '25-04-2026',
      }),
    ).toThrow();
  });
});
