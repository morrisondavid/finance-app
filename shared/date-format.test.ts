import { describe, it, expect } from 'vitest';
import { formatDateISO } from './date-format.js';

describe('formatDateISO', () => {
  it('formats a standard date', () => {
    expect(formatDateISO(new Date(2025, 0, 15))).toBe('2025-01-15');
  });

  it('zero-pads single-digit months', () => {
    expect(formatDateISO(new Date(2025, 2, 5))).toBe('2025-03-05');
  });

  it('zero-pads single-digit days', () => {
    expect(formatDateISO(new Date(2025, 11, 1))).toBe('2025-12-01');
  });

  it('handles month boundaries', () => {
    expect(formatDateISO(new Date(2025, 0, 31))).toBe('2025-01-31');
  });

  it('handles year rollover', () => {
    expect(formatDateISO(new Date(2025, 11, 31))).toBe('2025-12-31');
  });

  it('handles leap year Feb 29', () => {
    expect(formatDateISO(new Date(2024, 1, 29))).toBe('2024-02-29');
  });

  it('handles start of year', () => {
    expect(formatDateISO(new Date(2025, 0, 1))).toBe('2025-01-01');
  });
});
