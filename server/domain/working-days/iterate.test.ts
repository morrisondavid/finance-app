import { describe, it, expect } from 'vitest';
import { iterateWorkingDays } from './iterate.js';
import type { WeekdayMask } from './weekday-mask.js';

const MON_TO_FRI: WeekdayMask = [true, true, true, true, true, false, false];
const ALL_SEVEN: WeekdayMask = [true, true, true, true, true, true, true];
const ALL_OFF: WeekdayMask = [false, false, false, false, false, false, false];

function collect(gen: Generator<string>): string[] {
  return Array.from(gen);
}

describe('iterateWorkingDays', () => {
  it('yields nothing for an inverted range', () => {
    expect(collect(iterateWorkingDays({ start: '2026-04-30', end: '2026-04-01', mask: ALL_SEVEN }))).toEqual([]);
  });

  it('yields a single day when start === end and the day is masked on', () => {
    // 2026-04-22 is a Wednesday (Mon-index 2)
    expect(collect(iterateWorkingDays({ start: '2026-04-22', end: '2026-04-22', mask: MON_TO_FRI })))
      .toEqual(['2026-04-22']);
  });

  it('yields nothing when start === end and the day is masked off', () => {
    // 2026-04-25 is a Saturday
    expect(collect(iterateWorkingDays({ start: '2026-04-25', end: '2026-04-25', mask: MON_TO_FRI })))
      .toEqual([]);
  });

  it('yields five weekdays across a Mon-Sun range under a Mon-Fri mask', () => {
    // 2026-04-20 is Monday, 2026-04-26 is Sunday
    expect(collect(iterateWorkingDays({ start: '2026-04-20', end: '2026-04-26', mask: MON_TO_FRI })))
      .toEqual(['2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24']);
  });

  it('yields seven days across a Mon-Sun range under an all-seven mask', () => {
    expect(collect(iterateWorkingDays({ start: '2026-04-20', end: '2026-04-26', mask: ALL_SEVEN })))
      .toEqual([
        '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24',
        '2026-04-25', '2026-04-26',
      ]);
  });

  it('yields nothing under an all-off mask regardless of range', () => {
    expect(collect(iterateWorkingDays({ start: '2026-04-20', end: '2026-04-26', mask: ALL_OFF }))).toEqual([]);
  });

  it('removes individual days when they appear in excludeDates', () => {
    const excludeDates = new Set<string>(['2026-04-22', '2026-04-23']);
    expect(collect(iterateWorkingDays({ start: '2026-04-20', end: '2026-04-24', mask: MON_TO_FRI, excludeDates })))
      .toEqual(['2026-04-20', '2026-04-21', '2026-04-24']);
  });

  it('leaves weekend excludeDates as no-ops (already off via mask)', () => {
    const excludeDates = new Set<string>(['2026-04-25']);
    expect(collect(iterateWorkingDays({ start: '2026-04-20', end: '2026-04-26', mask: MON_TO_FRI, excludeDates })))
      .toEqual(['2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24']);
  });

  it('spans a month boundary correctly', () => {
    // 2026-04-30 is Thursday, 2026-05-01 Friday, 2026-05-02 Saturday
    expect(collect(iterateWorkingDays({ start: '2026-04-30', end: '2026-05-03', mask: MON_TO_FRI })))
      .toEqual(['2026-04-30', '2026-05-01']);
  });

  it('spans a year boundary correctly', () => {
    // 2025-12-31 is Wednesday, 2026-01-01 Thursday, 2026-01-02 Friday, 2026-01-03 Saturday
    expect(collect(iterateWorkingDays({ start: '2025-12-31', end: '2026-01-04', mask: MON_TO_FRI })))
      .toEqual(['2025-12-31', '2026-01-01', '2026-01-02']);
  });

  it('is DST-safe across the UK spring-forward boundary (2026-03-29)', () => {
    // 2026-03-27 Fri, 2026-03-28 Sat, 2026-03-29 Sun (clocks forward), 2026-03-30 Mon
    expect(collect(iterateWorkingDays({ start: '2026-03-27', end: '2026-03-30', mask: MON_TO_FRI })))
      .toEqual(['2026-03-27', '2026-03-30']);
  });
});
