import { describe, it, expect } from 'vitest';
import { matchesQuarter } from './statements.js';

describe('matchesQuarter', () => {
  describe('standard quarters (no overlap)', () => {
    it('Q1 includes Nov and Dec of previous year, Jan of target year', () => {
      expect(matchesQuarter('2024-11', 'Q1-2025')).toBe(true);
      expect(matchesQuarter('2024-12', 'Q1-2025')).toBe(true);
      expect(matchesQuarter('2025-01', 'Q1-2025')).toBe(true);
    });

    it('Q1 excludes months outside the quarter', () => {
      expect(matchesQuarter('2024-10', 'Q1-2025')).toBe(false);
      expect(matchesQuarter('2025-02', 'Q1-2025')).toBe(false);
    });

    it('Q2 includes Feb-Apr of target year', () => {
      expect(matchesQuarter('2025-02', 'Q2-2025')).toBe(true);
      expect(matchesQuarter('2025-03', 'Q2-2025')).toBe(true);
      expect(matchesQuarter('2025-04', 'Q2-2025')).toBe(true);
    });

    it('Q3 includes May-Jul', () => {
      expect(matchesQuarter('2025-05', 'Q3-2025')).toBe(true);
      expect(matchesQuarter('2025-06', 'Q3-2025')).toBe(true);
      expect(matchesQuarter('2025-07', 'Q3-2025')).toBe(true);
    });

    it('Q4 includes Aug-Oct', () => {
      expect(matchesQuarter('2025-08', 'Q4-2025')).toBe(true);
      expect(matchesQuarter('2025-09', 'Q4-2025')).toBe(true);
      expect(matchesQuarter('2025-10', 'Q4-2025')).toBe(true);
    });
  });

  describe('with overlapMonths = 1 (mid-month billing)', () => {
    it('Q1 with overlap 1 also includes Oct of previous year', () => {
      expect(matchesQuarter('2024-10', 'Q1-2025', 1)).toBe(true);
      expect(matchesQuarter('2024-11', 'Q1-2025', 1)).toBe(true);
      expect(matchesQuarter('2024-12', 'Q1-2025', 1)).toBe(true);
      expect(matchesQuarter('2025-01', 'Q1-2025', 1)).toBe(true);
    });

    it('Q1 with overlap 1 still excludes Sep of previous year', () => {
      expect(matchesQuarter('2024-09', 'Q1-2025', 1)).toBe(false);
    });

    it('Q2 with overlap 1 also includes Jan', () => {
      expect(matchesQuarter('2025-01', 'Q2-2025', 1)).toBe(true);
      expect(matchesQuarter('2025-02', 'Q2-2025', 1)).toBe(true);
      expect(matchesQuarter('2025-03', 'Q2-2025', 1)).toBe(true);
      expect(matchesQuarter('2025-04', 'Q2-2025', 1)).toBe(true);
    });

    it('Q4 with overlap 1 also includes Jul', () => {
      expect(matchesQuarter('2025-07', 'Q4-2025', 1)).toBe(true);
      expect(matchesQuarter('2025-08', 'Q4-2025', 1)).toBe(true);
      expect(matchesQuarter('2025-09', 'Q4-2025', 1)).toBe(true);
      expect(matchesQuarter('2025-10', 'Q4-2025', 1)).toBe(true);
    });

    it('Q4 with overlap 1 still excludes Jun', () => {
      expect(matchesQuarter('2025-06', 'Q4-2025', 1)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for invalid quarter param', () => {
      expect(matchesQuarter('2025-01', 'invalid')).toBe(false);
      expect(matchesQuarter('2025-01', 'Q5-2025')).toBe(false);
    });

    it('returns false for invalid display date', () => {
      expect(matchesQuarter('invalid', 'Q1-2025')).toBe(false);
    });

    it('overlapMonths = 0 behaves same as no overlap', () => {
      expect(matchesQuarter('2024-10', 'Q1-2025', 0)).toBe(false);
      expect(matchesQuarter('2024-11', 'Q1-2025', 0)).toBe(true);
    });
  });
});
