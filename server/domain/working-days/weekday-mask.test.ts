import { describe, it, expect } from 'vitest';
import { contractWeekdayMask, jsDayToMondayIndex } from './weekday-mask.js';

function makeContractMaskFixture(overrides: Partial<{
  works_monday: boolean;
  works_tuesday: boolean;
  works_wednesday: boolean;
  works_thursday: boolean;
  works_friday: boolean;
  works_saturday: boolean;
  works_sunday: boolean;
}>) {
  return {
    works_monday: false,
    works_tuesday: false,
    works_wednesday: false,
    works_thursday: false,
    works_friday: false,
    works_saturday: false,
    works_sunday: false,
    ...overrides,
  };
}

describe('contractWeekdayMask', () => {
  it('projects a Mon-Fri contract onto [T, T, T, T, T, F, F]', () => {
    const mask = contractWeekdayMask(makeContractMaskFixture({
      works_monday: true,
      works_tuesday: true,
      works_wednesday: true,
      works_thursday: true,
      works_friday: true,
    }));
    expect(mask).toEqual([true, true, true, true, true, false, false]);
  });

  it('projects an all-seven contract onto seven trues', () => {
    const mask = contractWeekdayMask(makeContractMaskFixture({
      works_monday: true,
      works_tuesday: true,
      works_wednesday: true,
      works_thursday: true,
      works_friday: true,
      works_saturday: true,
      works_sunday: true,
    }));
    expect(mask).toEqual([true, true, true, true, true, true, true]);
  });

  it('projects an all-off contract onto seven falses (degenerate but permitted)', () => {
    expect(contractWeekdayMask(makeContractMaskFixture({}))).toEqual([false, false, false, false, false, false, false]);
  });

  it('preserves the Mon-indexed order (weekend flags land at positions 5 and 6)', () => {
    const mask = contractWeekdayMask(makeContractMaskFixture({
      works_saturday: true,
      works_sunday: true,
    }));
    expect(mask[5]).toBe(true);
    expect(mask[6]).toBe(true);
    expect(mask.slice(0, 5)).toEqual([false, false, false, false, false]);
  });
});

describe('jsDayToMondayIndex', () => {
  it('maps JS Sunday=0 to Mon-index 6', () => {
    expect(jsDayToMondayIndex(0)).toBe(6);
  });

  it('maps JS Monday=1 to Mon-index 0', () => {
    expect(jsDayToMondayIndex(1)).toBe(0);
  });

  it('maps JS Saturday=6 to Mon-index 5', () => {
    expect(jsDayToMondayIndex(6)).toBe(5);
  });

  it('round-trips every JS day through a dense table', () => {
    const expected = [6, 0, 1, 2, 3, 4, 5];
    for (let js = 0; js < 7; js++) {
      expect(jsDayToMondayIndex(js)).toBe(expected[js]);
    }
  });
});
