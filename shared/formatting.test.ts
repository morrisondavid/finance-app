import { describe, it, expect } from 'vitest';
import { ordinal } from './formatting.js';

describe('ordinal', () => {
  it('handles 1st', () => expect(ordinal(1)).toBe('1st'));
  it('handles 2nd', () => expect(ordinal(2)).toBe('2nd'));
  it('handles 3rd', () => expect(ordinal(3)).toBe('3rd'));
  it('handles 4th', () => expect(ordinal(4)).toBe('4th'));
  it('handles 11th', () => expect(ordinal(11)).toBe('11th'));
  it('handles 12th', () => expect(ordinal(12)).toBe('12th'));
  it('handles 13th', () => expect(ordinal(13)).toBe('13th'));
  it('handles 21st', () => expect(ordinal(21)).toBe('21st'));
  it('handles 22nd', () => expect(ordinal(22)).toBe('22nd'));
  it('handles 23rd', () => expect(ordinal(23)).toBe('23rd'));
  it('handles 30th', () => expect(ordinal(30)).toBe('30th'));
  it('handles 31st', () => expect(ordinal(31)).toBe('31st'));
  it('handles 100th', () => expect(ordinal(100)).toBe('100th'));
  it('handles 101st', () => expect(ordinal(101)).toBe('101st'));
  it('handles 111th', () => expect(ordinal(111)).toBe('111th'));
  it('handles 112th', () => expect(ordinal(112)).toBe('112th'));
  it('handles 113th', () => expect(ordinal(113)).toBe('113th'));
});
