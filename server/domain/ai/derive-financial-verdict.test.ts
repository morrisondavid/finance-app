import { describe, it, expect } from 'vitest';
import { deriveFinancialVerdict } from './derive-financial-verdict.js';
import type { RunwayHolisticGbp } from '../../../shared/api-contracts.js';

const stressFree: RunwayHolisticGbp = {
  firstStressDateFullRecurring: null,
  runwayMonthsFullRecurring: null,
  firstStressDateMandatoryRecurring: null,
  runwayMonthsMandatoryRecurring: null,
};

describe('deriveFinancialVerdict', () => {
  it('returns negative_after_commitments when 12m cash-after is below zero', () => {
    const v = deriveFinancialVerdict({
      today: '2026-05-01',
      cashAfter12MonthCommitmentsGbp: -100,
      holisticGbp: stressFree,
      commitmentWindowEndDate: '2026-07-30',
    });
    expect(v.kind).toBe('negative_after_commitments');
    if (v.kind === 'negative_after_commitments') {
      expect(v.cashAfter12MonthCommitmentsGbp).toBe(-100);
    }
  });

  it('returns safe when cash-after is non-negative and there is no stress date', () => {
    const v = deriveFinancialVerdict({
      today: '2026-05-01',
      cashAfter12MonthCommitmentsGbp: 5_000,
      holisticGbp: stressFree,
      commitmentWindowEndDate: '2026-07-30',
    });
    expect(v.kind).toBe('safe');
  });

  it('returns deficit_imminent when stress falls inside the commitment window', () => {
    const v = deriveFinancialVerdict({
      today: '2026-05-01',
      cashAfter12MonthCommitmentsGbp: 5_000,
      holisticGbp: {
        ...stressFree,
        firstStressDateFullRecurring: '2026-06-10',
        runwayMonthsFullRecurring: 1.2,
      },
      commitmentWindowEndDate: '2026-07-30',
    });
    expect(v.kind).toBe('deficit_imminent');
    if (v.kind === 'deficit_imminent') {
      expect(v.deficitInDays).toBe(40);
      expect(v.firstStressDateFullRecurring).toBe('2026-06-10');
    }
  });

  it('returns runway_stressed when stress is after the window end', () => {
    const v = deriveFinancialVerdict({
      today: '2026-05-01',
      cashAfter12MonthCommitmentsGbp: 5_000,
      holisticGbp: {
        ...stressFree,
        firstStressDateFullRecurring: '2027-02-01',
        runwayMonthsFullRecurring: 9,
      },
      commitmentWindowEndDate: '2026-07-30',
    });
    expect(v.kind).toBe('runway_stressed');
    if (v.kind === 'runway_stressed') {
      expect(v.firstStressDateFullRecurring).toBe('2027-02-01');
      expect(v.deficitInDays).toBe(276);
    }
  });
});
