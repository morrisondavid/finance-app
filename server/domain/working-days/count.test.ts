import { describe, it, expect } from 'vitest';
import { countWorkingDays } from './count.js';
import { iterateWorkingDays } from './iterate.js';
import type { WeekdayMask } from './weekday-mask.js';

const MON_TO_FRI: WeekdayMask = [true, true, true, true, true, false, false];
const ALL_SEVEN: WeekdayMask = [true, true, true, true, true, true, true];

describe('countWorkingDays', () => {
  it('returns 0 for an inverted range', () => {
    expect(countWorkingDays({ start: '2026-04-30', end: '2026-04-01', mask: ALL_SEVEN })).toBe(0);
  });

  it('returns 0 for a single weekend day under Mon-Fri', () => {
    expect(countWorkingDays({ start: '2026-04-25', end: '2026-04-25', mask: MON_TO_FRI })).toBe(0);
  });

  it('returns 1 for a single weekday under Mon-Fri', () => {
    expect(countWorkingDays({ start: '2026-04-22', end: '2026-04-22', mask: MON_TO_FRI })).toBe(1);
  });

  it('returns 5 for a Mon-Sun range under Mon-Fri', () => {
    expect(countWorkingDays({ start: '2026-04-20', end: '2026-04-26', mask: MON_TO_FRI })).toBe(5);
  });

  it('returns 7 for a Mon-Sun range under all-seven', () => {
    expect(countWorkingDays({ start: '2026-04-20', end: '2026-04-26', mask: ALL_SEVEN })).toBe(7);
  });

  it('subtracts excluded days', () => {
    const excludeDates = new Set<string>(['2026-04-22', '2026-04-23']);
    expect(countWorkingDays({ start: '2026-04-20', end: '2026-04-24', mask: MON_TO_FRI, excludeDates })).toBe(3);
  });

  it('matches iterator length (parity lock against drift)', () => {
    const cases = [
      { start: '2026-04-01', end: '2026-04-30', mask: MON_TO_FRI },
      { start: '2026-04-01', end: '2026-04-30', mask: ALL_SEVEN },
      { start: '2025-12-15', end: '2026-01-15', mask: MON_TO_FRI },
      { start: '2024-02-01', end: '2024-02-29', mask: MON_TO_FRI },
      { start: '2026-03-20', end: '2026-04-05', mask: MON_TO_FRI },
    ];
    for (const c of cases) {
      expect(countWorkingDays(c)).toBe(Array.from(iterateWorkingDays(c)).length);
    }
  });

  it('matches iterator length with excludeDates', () => {
    const excludeDates = new Set<string>(['2026-04-06', '2026-04-07', '2026-04-08']);
    const c = { start: '2026-04-01', end: '2026-04-30', mask: MON_TO_FRI, excludeDates };
    expect(countWorkingDays(c)).toBe(Array.from(iterateWorkingDays(c)).length);
  });
});
