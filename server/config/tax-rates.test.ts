import { describe, it, expect } from 'vitest';
import { 
  VAT,
  CORPORATION_TAX,
  DIVIDEND_TAX,
  VAT_QUARTERS,
  UAE_CORPORATION_TAX,
  calculateCorporationTax,
  corporationTaxObligationAmounts,
  vatObligationAmounts,
  calculateDividendTax,
  calculateNonResidentSaTax,
  estimateNonResidentPropertyCgt,
  CAPITAL_GAINS_TAX,
  calculateRetainedReserves,
  getVatQuarterForDate,
  getCurrentVatQuarter,
  resolveInvoiceVatRate,
} from './tax-rates.js';
import { parseCompanyRow } from '../domain/company/csv-io.js';
import { ukRow, uaeRow, rowFromHeaders } from '../domain/company/test-helpers.js';
import type { UkCompany } from '../../shared/api-contracts.js';

function ukLtdFromRow(row: Record<string, string>): UkCompany {
  const c = parseCompanyRow(row);
  if (c.jurisdiction !== 'UK' || c.kind !== 'ltd') {
    throw new Error('expected UK ltd company fixture');
  }
  return c;
}

describe('Tax Constants', () => {
  describe('VAT', () => {
    it('should have correct VAT rate', () => {
      expect(VAT.RATE).toBe(0.2);
    });

    it('should have correct VAT fraction for VAT-inclusive amounts', () => {
      expect(VAT.FRACTION).toBeCloseTo(1/6, 10);
    });

    it('should correctly calculate VAT from gross amount', () => {
      // £12,000 gross should have £2,000 VAT
      const gross = 12000;
      const vat = gross * VAT.FRACTION;
      expect(vat).toBeCloseTo(2000, 2);
    });
  });

  describe('VAT_QUARTERS (Stagger 2)', () => {
    it('should have 4 quarters defined', () => {
      expect(VAT_QUARTERS.STAGGER_2).toHaveLength(4);
    });

    it('should have correct quarter definitions', () => {
      const [q1, q2, q3, q4] = VAT_QUARTERS.STAGGER_2;
      
      // Q1: Nov-Jan (months 10, 0)
      expect(q1.quarter).toBe(1);
      expect(q1.startMonth).toBe(10); // November
      expect(q1.endMonth).toBe(0);    // January
      expect(q1.label).toBe('Nov-Jan');
      
      // Q2: Feb-Apr (months 1, 3)
      expect(q2.quarter).toBe(2);
      expect(q2.startMonth).toBe(1);  // February
      expect(q2.endMonth).toBe(3);    // April
      expect(q2.label).toBe('Feb-Apr');
      
      // Q3: May-Jul (months 4, 6)
      expect(q3.quarter).toBe(3);
      expect(q3.startMonth).toBe(4);  // May
      expect(q3.endMonth).toBe(6);    // July
      expect(q3.label).toBe('May-Jul');
      
      // Q4: Aug-Oct (months 7, 9)
      expect(q4.quarter).toBe(4);
      expect(q4.startMonth).toBe(7);  // August
      expect(q4.endMonth).toBe(9);    // October
      expect(q4.label).toBe('Aug-Oct');
    });
  });

  describe('Corporation Tax', () => {
    it('should have correct small profits rate', () => {
      expect(CORPORATION_TAX.SMALL_PROFITS_RATE).toBe(0.19);
    });

    it('should have correct main rate', () => {
      expect(CORPORATION_TAX.MAIN_RATE).toBe(0.25);
    });

    it('should have correct thresholds', () => {
      expect(CORPORATION_TAX.SMALL_PROFITS_THRESHOLD).toBe(50000);
      expect(CORPORATION_TAX.MAIN_RATE_THRESHOLD).toBe(250000);
    });
  });

  describe('Dividend Tax', () => {
    it('should have correct allowance', () => {
      expect(DIVIDEND_TAX.ALLOWANCE).toBe(1000);
    });

    it('should have correct rates', () => {
      expect(DIVIDEND_TAX.BASIC_RATE).toBe(0.0875);
      expect(DIVIDEND_TAX.HIGHER_RATE).toBe(0.3375);
    });
  });
});

describe('calculateCorporationTax', () => {
  it('should return 0 for zero or negative profit', () => {
    expect(calculateCorporationTax(0)).toEqual({ tax: 0, effectiveRate: 0 });
    expect(calculateCorporationTax(-1000)).toEqual({ tax: 0, effectiveRate: 0 });
  });

  it('should apply 19% for profits under £50,000', () => {
    const result = calculateCorporationTax(30000);
    expect(result.tax).toBe(30000 * 0.19);
    expect(result.effectiveRate).toBe(0.19);
  });

  it('should apply 19% for profits exactly at £50,000', () => {
    const result = calculateCorporationTax(50000);
    expect(result.tax).toBe(50000 * 0.19);
    expect(result.effectiveRate).toBe(0.19);
  });

  it('should apply 25% for profits at or above £250,000', () => {
    const result = calculateCorporationTax(250000);
    expect(result.tax).toBe(250000 * 0.25);
    expect(result.effectiveRate).toBe(0.25);

    const result2 = calculateCorporationTax(500000);
    expect(result2.tax).toBe(500000 * 0.25);
    expect(result2.effectiveRate).toBe(0.25);
  });

  it('should apply marginal relief for profits between £50,000 and £250,000', () => {
    // Test case: £169,136.01 profit (from the actual app)
    const profit = 169136.01;
    const result = calculateCorporationTax(profit);
    
    // Expected: Tax = 25% of profit - (250000 - profit) * 3/200
    const expectedTax = (profit * 0.25) - ((250000 - profit) * 3 / 200);
    const expectedRate = expectedTax / profit;
    
    expect(result.tax).toBeCloseTo(expectedTax, 2);
    expect(result.effectiveRate).toBeCloseTo(expectedRate, 4);
    
    // Rate should be between 19% and 25%
    expect(result.effectiveRate).toBeGreaterThan(0.19);
    expect(result.effectiveRate).toBeLessThan(0.25);
  });

  it('should calculate correct rate at midpoint (£150,000)', () => {
    const profit = 150000;
    const result = calculateCorporationTax(profit);
    
    // At £150k, effective rate should be around 22%
    expect(result.effectiveRate).toBeCloseTo(0.22, 1);
  });
});

describe('corporationTaxObligationAmounts', () => {
  it('returns null when naive CT is zero', () => {
    const co = ukLtdFromRow(ukRow);
    expect(corporationTaxObligationAmounts(0, co)).toBeNull();
  });

  it('uses marginal-relief naive and matches expected when no historical rate', () => {
    const co = ukLtdFromRow(
      rowFromHeaders({ ...ukRow, historical_effective_ct_rate: '' }),
    );
    const profit = 169136.01;
    const r = corporationTaxObligationAmounts(profit, co);
    expect(r).not.toBeNull();
    expect(r!.naiveAmount).toBeCloseTo(calculateCorporationTax(profit).tax, 2);
    expect(r!.expectedAmount).toBe(r!.naiveAmount);
    expect(r!.adjustmentSource).toBe('computed');
  });

  it('applies historical_effective_ct_rate to expectedAmount', () => {
    const co = ukLtdFromRow(
      rowFromHeaders({ ...ukRow, historical_effective_ct_rate: '0.21' }),
    );
    const profit = 100000;
    const r = corporationTaxObligationAmounts(profit, co);
    expect(r).not.toBeNull();
    expect(r!.naiveAmount).toBeCloseTo(calculateCorporationTax(profit).tax, 2);
    expect(r!.expectedAmount).toBeCloseTo(21000, 2);
    expect(r!.adjustmentSource).toBe('company.historical_effective_ct_rate');
  });
});

describe('vatObligationAmounts', () => {
  it('returns null when naive VAT is zero', () => {
    const co = ukLtdFromRow(ukRow);
    expect(vatObligationAmounts(0, co)).toBeNull();
  });

  it('matches ledger × fraction when no historical VAT rate', () => {
    const co = ukLtdFromRow(
      rowFromHeaders({ ...ukRow, historical_effective_vat_rate: '' }),
    );
    const income = 12000;
    const r = vatObligationAmounts(income, co);
    expect(r).not.toBeNull();
    expect(r!.naiveAmount).toBeCloseTo(2000, 2);
    expect(r!.expectedAmount).toBe(r!.naiveAmount);
    expect(r!.adjustmentSource).toBe('computed');
  });

  it('applies historical_effective_vat_rate on gross income', () => {
    const co = ukLtdFromRow(
      rowFromHeaders({ ...ukRow, historical_effective_vat_rate: '0.18' }),
    );
    const income = 10000;
    const r = vatObligationAmounts(income, co);
    expect(r).not.toBeNull();
    expect(r!.naiveAmount).toBeCloseTo(10000 / 6, 2);
    expect(r!.expectedAmount).toBeCloseTo(1800, 2);
    expect(r!.adjustmentSource).toBe('company.historical_effective_vat_rate');
  });
});

describe('calculateDividendTax', () => {
  it('should return 0 for dividends within allowance', () => {
    expect(calculateDividendTax(1000)).toBe(0);
    expect(calculateDividendTax(500)).toBe(0);
  });

  it('should return 0 when unused personal allowance covers dividends after dividend allowance', () => {
    // £5000 dividends, no salary: PA £12570 covers £4000 after £1000 dividend allowance → no dividend tax
    expect(calculateDividendTax(5000, 0)).toBe(0);
  });

  it('should apply basic rate when salary uses PA but dividends remain taxable', () => {
    // Salary exactly uses PA; £4000 taxable dividends, all in basic band
    const tax = calculateDividendTax(5000, 12570);
    expect(tax).toBeCloseTo(4000 * 0.0875, 2);
  });

  it('should stack salary in bands then split dividends across basic and higher rate', () => {
    // £10000 dividends with £45000 salary (taxable salary £32430 in basic band; £5270 basic left for dividends)
    const tax = calculateDividendTax(10000, 45000);
    const expected = (5270 * 0.0875) + (3730 * 0.3375);
    expect(tax).toBeCloseTo(expected, 2);
  });

  it('should apply higher rate when basic band exhausted by salary', () => {
    const tax = calculateDividendTax(5000, 60000);
    expect(tax).toBeCloseTo(4000 * 0.3375, 2);
  });

  it('should reduce dividend tax when salary leaves part of PA unused (12 × £758 salary)', () => {
    // Full-year net salary £9096; £5k dividends → £4k after dividend allowance; unused PA £3474 → £526 taxable at basic
    const salary = 758 * 12;
    const tax = calculateDividendTax(5000, salary);
    const unusedPa = 12570 - salary;
    const taxableDiv = Math.max(0, 5000 - 1000 - unusedPa);
    expect(taxableDiv).toBeCloseTo(526, 2);
    expect(tax).toBeCloseTo(526 * 0.0875, 2);
  });

  it('should charge no dividend tax when unused PA fully covers post-allowance dividends', () => {
    const tax = calculateDividendTax(5000, 7580);
    expect(tax).toBe(0);
  });
});

describe('calculateNonResidentSaTax', () => {
  it('uses disregarded basis when UK dividends would dominate resident tax', () => {
    const result = calculateNonResidentSaTax({
      salary: 9096,
      dividends: 50000,
      rentalIncome: 5000,
      retainsPersonalAllowance: true,
    });
    expect(result.disregardedBasisTax).toBeLessThan(result.residentBasisTax);
    expect(result.basisUsed).toBe('non-resident-disregarded');
    expect(result.dividendsDisregarded).toBe(true);
    expect(result.tax).toBe(result.disregardedBasisTax);
  });

  it('uses resident basis when it is lower than disregarded (rental-heavy)', () => {
    const result = calculateNonResidentSaTax({
      salary: 0,
      dividends: 0,
      rentalIncome: 15000,
      retainsPersonalAllowance: true,
    });
    expect(result.residentBasisTax).toBeLessThan(result.disregardedBasisTax);
    expect(result.basisUsed).toBe('non-resident-resident-basis');
    expect(result.dividendsDisregarded).toBe(false);
  });
});

describe('estimateNonResidentPropertyCgt', () => {
  it('rebases to April 2015 value when acquisition predates rebasing date', () => {
    const result = estimateNonResidentPropertyCgt({
      proceeds: 550000,
      acquisitionDate: '2010-06-01',
      acquisitionCost: 280000,
      april2015Value: 420000,
      enhancementCosts: 15000,
      sellingCosts: 12000,
      ownerShare: 0.5,
      estimatedTaxableIncome: 20000,
    });
    expect(result.rebased).toBe(true);
    expect(result.costBasisUsed).toBe(420000);
    expect(result.grossGain).toBeGreaterThan(0);
    expect(result.estimatedTax).toBeGreaterThan(0);
  });

  it('applies annual exempt amount before taxing gain', () => {
    const withoutAea = estimateNonResidentPropertyCgt({
      proceeds: 100000,
      acquisitionDate: '2020-01-01',
      acquisitionCost: 90000,
      april2015Value: null,
      enhancementCosts: 0,
      sellingCosts: 0,
      ownerShare: 1,
      estimatedTaxableIncome: 0,
    });
    expect(withoutAea.grossGain).toBe(10000);
    expect(withoutAea.taxableGain).toBe(10000 - CAPITAL_GAINS_TAX.ANNUAL_EXEMPT_AMOUNT);
  });
});

// =============================================================================
// VAT Quarter Tests (Stagger 2: Nov-Jan, Feb-Apr, May-Jul, Aug-Oct)
// =============================================================================

describe('getVatQuarterForDate', () => {
  describe('Q1: Nov-Jan', () => {
    it('should return Q1 for November dates', () => {
      const result = getVatQuarterForDate(new Date('2025-11-01'));
      expect(result.quarter).toBe(1);
      expect(result.label).toBe('Nov-Jan 2025/26');
      expect(result.startDate).toBe('2025-11-01');
      expect(result.endDate).toBe('2026-01-31');
      expect(result.dueDate).toBe('2026-03-07');
    });

    it('should return Q1 for December dates', () => {
      const result = getVatQuarterForDate(new Date('2025-12-15'));
      expect(result.quarter).toBe(1);
      expect(result.label).toBe('Nov-Jan 2025/26');
      expect(result.startDate).toBe('2025-11-01');
      expect(result.endDate).toBe('2026-01-31');
    });

    it('should return Q1 for January dates', () => {
      const result = getVatQuarterForDate(new Date('2026-01-25'));
      expect(result.quarter).toBe(1);
      expect(result.label).toBe('Nov-Jan 2025/26');
      expect(result.startDate).toBe('2025-11-01');
      expect(result.endDate).toBe('2026-01-31');
      expect(result.dueDate).toBe('2026-03-07');
    });

    it('should handle year boundary correctly (Jan belongs to previous Nov)', () => {
      // January 2026 should be in Nov 2025 - Jan 2026 quarter
      const result = getVatQuarterForDate(new Date('2026-01-01'));
      expect(result.startDate).toBe('2025-11-01');
      expect(result.endDate).toBe('2026-01-31');
    });
  });

  describe('Q2: Feb-Apr', () => {
    it('should return Q2 for February dates', () => {
      const result = getVatQuarterForDate(new Date('2026-02-15'));
      expect(result.quarter).toBe(2);
      expect(result.label).toBe('Feb-Apr 2026');
      expect(result.startDate).toBe('2026-02-01');
      expect(result.endDate).toBe('2026-04-30');
      expect(result.dueDate).toBe('2026-06-07');
    });

    it('should return Q2 for April dates', () => {
      const result = getVatQuarterForDate(new Date('2026-04-30'));
      expect(result.quarter).toBe(2);
      expect(result.label).toBe('Feb-Apr 2026');
    });
  });

  describe('Q3: May-Jul', () => {
    it('should return Q3 for May dates', () => {
      const result = getVatQuarterForDate(new Date('2026-05-01'));
      expect(result.quarter).toBe(3);
      expect(result.label).toBe('May-Jul 2026');
      expect(result.startDate).toBe('2026-05-01');
      expect(result.endDate).toBe('2026-07-31');
      expect(result.dueDate).toBe('2026-09-07');
    });

    it('should return Q3 for July dates', () => {
      const result = getVatQuarterForDate(new Date('2026-07-31'));
      expect(result.quarter).toBe(3);
    });
  });

  describe('Q4: Aug-Oct', () => {
    it('should return Q4 for August dates', () => {
      const result = getVatQuarterForDate(new Date('2025-08-01'));
      expect(result.quarter).toBe(4);
      expect(result.label).toBe('Aug-Oct 2025');
      expect(result.startDate).toBe('2025-08-01');
      expect(result.endDate).toBe('2025-10-31');
      expect(result.dueDate).toBe('2025-12-07');
    });

    it('should return Q4 for October dates', () => {
      const result = getVatQuarterForDate(new Date('2025-10-31'));
      expect(result.quarter).toBe(4);
    });
  });

  describe('Due date calculation', () => {
    it('should set due date to 7th of 2nd month after quarter end', () => {
      // Q1 ends Jan 31 -> due Mar 7
      expect(getVatQuarterForDate(new Date('2026-01-15')).dueDate).toBe('2026-03-07');
      
      // Q2 ends Apr 30 -> due Jun 7
      expect(getVatQuarterForDate(new Date('2026-03-15')).dueDate).toBe('2026-06-07');
      
      // Q3 ends Jul 31 -> due Sep 7
      expect(getVatQuarterForDate(new Date('2026-06-15')).dueDate).toBe('2026-09-07');
      
      // Q4 ends Oct 31 -> due Dec 7
      expect(getVatQuarterForDate(new Date('2025-09-15')).dueDate).toBe('2025-12-07');
    });
  });

  describe('Edge cases', () => {
    it('should handle first day of quarter', () => {
      const nov1 = getVatQuarterForDate(new Date('2025-11-01'));
      expect(nov1.quarter).toBe(1);
      
      const feb1 = getVatQuarterForDate(new Date('2026-02-01'));
      expect(feb1.quarter).toBe(2);
      
      const may1 = getVatQuarterForDate(new Date('2026-05-01'));
      expect(may1.quarter).toBe(3);
      
      const aug1 = getVatQuarterForDate(new Date('2025-08-01'));
      expect(aug1.quarter).toBe(4);
    });

    it('should handle last day of quarter', () => {
      const jan31 = getVatQuarterForDate(new Date('2026-01-31'));
      expect(jan31.quarter).toBe(1);
      
      const apr30 = getVatQuarterForDate(new Date('2026-04-30'));
      expect(apr30.quarter).toBe(2);
      
      const jul31 = getVatQuarterForDate(new Date('2026-07-31'));
      expect(jul31.quarter).toBe(3);
      
      const oct31 = getVatQuarterForDate(new Date('2025-10-31'));
      expect(oct31.quarter).toBe(4);
    });

    it('should handle leap year February', () => {
      // 2024 is a leap year, Feb has 29 days
      // But Q2 ends in April, so this doesn't affect end date
      const result = getVatQuarterForDate(new Date('2024-02-29'));
      expect(result.quarter).toBe(2);
      expect(result.endDate).toBe('2024-04-30');
    });
  });
});

describe('calculateRetainedReserves', () => {
  const ukVatRegistered = parseCompanyRow(ukRow);
  const ukNotVatRegistered = parseCompanyRow(
    rowFromHeaders({ ...ukRow, vat_registered: 'false' }),
  );
  const fzcoQualifying = parseCompanyRow(
    rowFromHeaders({ ...uaeRow, qfzp_elected: 'true' }),
  );
  const fzcoNonQualifying = parseCompanyRow(
    rowFromHeaders({ ...uaeRow, qfzp_elected: 'false' }),
  );
  const fzcoTbc = parseCompanyRow(uaeRow); // qfzp_elected='TBC' → treated as non-qualifying

  describe('UK Ltd, VAT-registered', () => {
    it('applies 20% VAT and 25% CT on £10,000 net', () => {
      const r = calculateRetainedReserves(10000, ukVatRegistered);
      expect(r.incoming_period_total).toBeCloseTo(12000, 6);
      expect(r.vat_reserve_period).toBeCloseTo(2000, 6);
      expect(r.ct_reserve_period).toBeCloseTo(2500, 6);
      expect(r.retained_period).toBeCloseTo(7500, 6);
      expect(r.vat_rate_applied).toBe(VAT.RATE);
      expect(r.ct_rate_applied).toBe(CORPORATION_TAX.MAIN_RATE);
    });

    it('reconciles: incoming === retained + vat + ct_reserve', () => {
      const r = calculateRetainedReserves(10000, ukVatRegistered);
      expect(r.retained_period + r.vat_reserve_period + r.ct_reserve_period)
        .toBeCloseTo(r.incoming_period_total, 6);
    });
  });

  describe('UK Ltd, NOT VAT-registered (edge)', () => {
    it('adds no VAT but still reserves 25% CT', () => {
      const r = calculateRetainedReserves(10000, ukNotVatRegistered);
      expect(r.vat_reserve_period).toBe(0);
      expect(r.vat_rate_applied).toBe(0);
      expect(r.incoming_period_total).toBeCloseTo(10000, 6);
      expect(r.ct_reserve_period).toBeCloseTo(2500, 6);
      expect(r.retained_period).toBeCloseTo(7500, 6);
    });
  });

  describe('UAE FZCO, QFZP qualifying', () => {
    it('applies zero VAT and zero CT on £11,000 net', () => {
      const r = calculateRetainedReserves(11000, fzcoQualifying);
      expect(r.incoming_period_total).toBeCloseTo(11000, 6);
      expect(r.vat_reserve_period).toBe(0);
      expect(r.ct_reserve_period).toBe(0);
      expect(r.retained_period).toBeCloseTo(11000, 6);
      expect(r.ct_rate_applied).toBe(UAE_CORPORATION_TAX.QUALIFYING_RATE);
      expect(r.vat_rate_applied).toBe(0);
    });
  });

  describe('UAE FZCO, non-qualifying', () => {
    it('applies 9% CT on £10,000 net — retained is 91%', () => {
      const r = calculateRetainedReserves(10000, fzcoNonQualifying);
      expect(r.vat_reserve_period).toBe(0);
      expect(r.incoming_period_total).toBeCloseTo(10000, 6);
      expect(r.ct_reserve_period).toBeCloseTo(900, 6);
      expect(r.retained_period).toBeCloseTo(9100, 6);
      expect(r.ct_rate_applied).toBe(UAE_CORPORATION_TAX.NON_QUALIFYING_RATE);
    });

    it('treats qfzp_elected=TBC as non-qualifying (9% CT)', () => {
      const r = calculateRetainedReserves(10000, fzcoTbc);
      expect(r.ct_rate_applied).toBe(UAE_CORPORATION_TAX.NON_QUALIFYING_RATE);
      expect(r.ct_reserve_period).toBeCloseTo(900, 6);
    });
  });

  describe('edge cases', () => {
    it('returns all-zero on zero projection', () => {
      const r = calculateRetainedReserves(0, ukVatRegistered);
      expect(r.incoming_period_total).toBe(0);
      expect(r.vat_reserve_period).toBe(0);
      expect(r.ct_reserve_period).toBe(0);
      expect(r.retained_period).toBe(0);
    });

    it('floors negative projections at zero (defensive)', () => {
      const r = calculateRetainedReserves(-500, ukVatRegistered);
      expect(r.incoming_period_total).toBe(0);
      expect(r.retained_period).toBe(0);
    });

    it('reconciles for every jurisdiction/VAT/QFZP combination', () => {
      for (const company of [ukVatRegistered, ukNotVatRegistered, fzcoQualifying, fzcoNonQualifying, fzcoTbc]) {
        const r = calculateRetainedReserves(7777.77, company);
        expect(r.retained_period + r.vat_reserve_period + r.ct_reserve_period)
          .toBeCloseTo(r.incoming_period_total, 6);
      }
    });
  });
});

describe('resolveInvoiceVatRate', () => {
  const ukVatRegistered = parseCompanyRow(ukRow);
  const ukNotVatRegistered = parseCompanyRow(
    rowFromHeaders({ ...ukRow, vat_registered: 'false' }),
  );
  const ukVatTbc = parseCompanyRow(
    rowFromHeaders({ ...ukRow, vat_registered: 'TBC' }),
  );
  const fzco = parseCompanyRow(uaeRow);

  it('returns VAT.RATE for UK + vat_registered=true', () => {
    expect(resolveInvoiceVatRate(ukVatRegistered)).toBe(VAT.RATE);
  });

  it('returns 0 for UK + vat_registered=false', () => {
    expect(resolveInvoiceVatRate(ukNotVatRegistered)).toBe(0);
  });

  it('returns 0 for UK + vat_registered=TBC (conservative — do not charge VAT until confirmed)', () => {
    expect(resolveInvoiceVatRate(ukVatTbc)).toBe(0);
  });

  it('returns 0 for FZCO regardless of VAT registration (UAE — out of scope of UK VAT)', () => {
    expect(resolveInvoiceVatRate(fzco)).toBe(0);
  });

  it('is the same rule calculateRetainedReserves applies', () => {
    // Cross-check the two call sites stay wired to the same rule.
    const r = calculateRetainedReserves(10000, ukVatRegistered);
    expect(r.vat_rate_applied).toBe(resolveInvoiceVatRate(ukVatRegistered));

    const rFzco = calculateRetainedReserves(10000, fzco);
    expect(rFzco.vat_rate_applied).toBe(resolveInvoiceVatRate(fzco));
  });
});

describe('getCurrentVatQuarter', () => {
  it('should return a valid VatQuarterRange', () => {
    const result = getCurrentVatQuarter();
    
    expect(result).toHaveProperty('startDate');
    expect(result).toHaveProperty('endDate');
    expect(result).toHaveProperty('dueDate');
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('quarter');
    
    expect(result.quarter).toBeGreaterThanOrEqual(1);
    expect(result.quarter).toBeLessThanOrEqual(4);
    
    // Dates should be in ISO format
    expect(result.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
