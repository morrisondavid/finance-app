import { getDb } from '../connection.js';
import { buildDashboardFilters, type DashboardFilters } from '../utils/financial-year.js';
import { 
  VAT, 
  calculateCorporationTax, 
  INCOME_TAX,
  DIVIDEND_TAX,
  getCurrentVatQuarter,
  getVatQuarterForDate,
  type VatQuarterRange
} from '../../config/tax-rates.js';
import { DIRECTORS, HMRC_PATTERNS } from '../../config/payees.js';
import { getBusinessPaymentAccounts } from '../../types.js';

export interface TaxLiabilities {
  // VAT (outstanding quarter - due next)
  vatQuarter: VatQuarterRange;
  vatOwedThisQuarter: number;
  vatRate: number;
  
  // VAT (in-progress quarter - the one we're currently inside)
  vatInProgressQuarter: VatQuarterRange | null;
  vatInProgressEstimate: number;
  
  // VAT (historical - rolling 12 months / 4 quarters)
  vatPaidLast4Quarters: number;
  
  // Legacy fields (for backward compatibility)
  vatOnIncome: number;
  vatPaid: number;
  vatOutstanding: number;
  
  
  // Corporation Tax
  corporationTax: number;
  corporationTaxRate: number;
  taxableProfit: number;
  
  // David's Personal Tax (based on payments to director)
  davidPayments: {
    salary: number;
    dividends: number;
    total: number;
    annualSalary: number;
  };
  davidTaxEstimate: number;
  davidTaxBreakdown: {
    dividendTax: number;
  };
  
  // Heena's Personal Tax (based on payments)
  heenaPayments: {
    salary: number;
    dividends: number;
    total: number;
    annualSalary: number;
  };
  heenaTaxEstimate: number;
  heenaTaxBreakdown: {
    dividendTax: number;
  };
}

/**
 * Get salary and dividend payments for a director
 */
function getDirectorPayments(
  db: ReturnType<typeof getDb>,
  namePattern: string,
  salaryMin: number,
  salaryMax: number,
  clause: string,
  params: string[]
): { salary: number; dividends: number; total: number; annualSalary: number } {
  const salaryResult = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as total 
    FROM transactions 
    WHERE type = 'expense' 
    AND description LIKE ?
    AND ABS(amount) >= ? AND ABS(amount) <= ?
    ${clause}
  `).get(namePattern, salaryMin, salaryMax, ...params) as { total: number };
  
  const dividendResult = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as total 
    FROM transactions 
    WHERE type = 'expense' 
    AND description LIKE ?
    AND (ABS(amount) < ? OR ABS(amount) > ?)
    ${clause}
  `).get(namePattern, salaryMin, salaryMax, ...params) as { total: number };
  
  const salary = Math.round(salaryResult.total * 100) / 100;
  const dividends = Math.round(dividendResult.total * 100) / 100;
  
  return {
    salary,
    dividends,
    total: salary + dividends,
    annualSalary: salaryMin * 12
  };
}

/**
 * Calculate dividend tax for a director
 */
function calculateDirectorDividendTax(salary: number, dividends: number): number {
  if (dividends <= DIVIDEND_TAX.ALLOWANCE) {
    return 0;
  }
  
  const taxableDividends = dividends - DIVIDEND_TAX.ALLOWANCE;
  const remainingBasicBand = Math.max(0, INCOME_TAX.BASIC_RATE_LIMIT - salary);
  
  if (taxableDividends <= remainingBasicBand) {
    return taxableDividends * DIVIDEND_TAX.BASIC_RATE;
  }
  
  return (remainingBasicBand * DIVIDEND_TAX.BASIC_RATE) + 
         ((taxableDividends - remainingBasicBand) * DIVIDEND_TAX.HIGHER_RATE);
}

/**
 * Calculate UK tax liabilities based on income
 * 
 * VAT: 20% of net income (assuming VAT registered, income is VAT-inclusive)
 * Corporation Tax: 19% for profits under £50k, 25% for over £250k, marginal between
 *   - Calculated on income only (expenses are NOT deducted)
 *   - This provides a conservative/worst-case tax liability estimate
 * Personal Tax: Based on payments to directors
 */
export function getTaxLiabilities(filters: DashboardFilters = {}): TaxLiabilities {
  const db = getDb();
  const { clause, params } = buildDashboardFilters(filters);
  
  // Get income for the selected financial year (for Corp Tax, etc.)
  const incomeResult = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'income'${clause}
  `).get(...params) as { total: number };
  
  const income = incomeResult.total;
  
  // VAT calculation - use current VAT QUARTER, not financial year
  const vatQuarter = getCurrentVatQuarter();
  
  // Get income for the current VAT quarter only
  const vatQuarterIncomeResult = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total 
    FROM transactions 
    WHERE type = 'income'
    AND date >= ? AND date <= ?
  `).get(vatQuarter.startDate, vatQuarter.endDate) as { total: number };
  
  const vatQuarterIncome = vatQuarterIncomeResult.total;
  const vatOwedThisQuarter = Math.round((vatQuarterIncome * VAT.FRACTION) * 100) / 100;
  
  // In-progress quarter: the quarter we're currently inside (may differ from outstanding)
  const calendarQuarter = getVatQuarterForDate(new Date());
  let vatInProgressQuarter: VatQuarterRange | null = null;
  let vatInProgressEstimate = 0;
  
  if (calendarQuarter.startDate !== vatQuarter.startDate) {
    vatInProgressQuarter = calendarQuarter;
    const inProgressIncomeResult = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM transactions 
      WHERE type = 'income'
      AND date >= ? AND date <= ?
    `).get(calendarQuarter.startDate, calendarQuarter.endDate) as { total: number };
    vatInProgressEstimate = Math.round((inProgressIncomeResult.total * VAT.FRACTION) * 100) / 100;
  }
  
  // Legacy: VAT on income for the FY (still needed for some displays)
  const vatOnIncome = Math.round((income * VAT.FRACTION) * 100) / 100;
  
  // Get VAT already paid to HMRC (rolling 12 months / 4 quarters)
  // VAT payments can come from any business account that can make payments
  const vatAccounts = getBusinessPaymentAccounts();
  const vatPatterns = HMRC_PATTERNS.VAT; // Array of patterns: ['HMRC VAT%', 'HMRC ETMP%']
  
  // Build pattern condition (OR for each pattern)
  const patternCondition = vatPatterns.map(() => 'description LIKE ?').join(' OR ');
  // Build account condition
  const accountPlaceholders = vatAccounts.map(() => '?').join(',');
  
  // Calculate rolling 12-month window (4 VAT quarters)
  const today = new Date();
  const twelveMonthsAgo = new Date(today);
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  
  const formatDate = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const vatPaidResult = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as total 
    FROM transactions 
    WHERE type = 'expense' 
    AND (${patternCondition})
    AND account IN (${accountPlaceholders})
    AND date >= ? AND date <= ?
  `).get(...vatPatterns, ...vatAccounts, formatDate(twelveMonthsAgo), formatDate(today)) as { total: number };
  
  const vatPaidLast4Quarters = Math.round(vatPaidResult.total * 100) / 100;
  
  // Get director payments
  const david = DIRECTORS.find(d => d.name === 'David Morrison');
  const heena = DIRECTORS.find(d => d.name === 'Heena Tailor');
  
  const davidPayments = david 
    ? getDirectorPayments(db, david.namePattern, david.salaryMin, david.salaryMax, clause, params)
    : { salary: 0, dividends: 0, total: 0, annualSalary: 0 };
    
  const heenaPayments = heena
    ? getDirectorPayments(db, heena.namePattern, heena.salaryMin, heena.salaryMax, clause, params)
    : { salary: 0, dividends: 0, total: 0, annualSalary: 0 };
  
  // Corporation Tax calculation
  // Taxable profit = Income (net of VAT) only - expenses NOT deducted (conservative estimate)
  const incomeNetOfVat = income - vatOnIncome;
  const taxableProfit = Math.max(0, incomeNetOfVat);
  
  const corpTax = calculateCorporationTax(taxableProfit);
  const corporationTax = Math.round(corpTax.tax * 100) / 100;
  const corporationTaxRate = Math.round(corpTax.effectiveRate * 10000) / 100; // as percentage
  
  // Calculate dividend tax for each director
  const davidDividendTax = calculateDirectorDividendTax(davidPayments.salary, davidPayments.dividends);
  const heenaDividendTax = calculateDirectorDividendTax(heenaPayments.salary, heenaPayments.dividends);
  
  return {
    // VAT (outstanding quarter - due next)
    vatQuarter,
    vatOwedThisQuarter,
    vatRate: VAT.RATE,
    
    // VAT (in-progress quarter)
    vatInProgressQuarter,
    vatInProgressEstimate,
    
    // VAT (historical - rolling 12 months)
    vatPaidLast4Quarters,
    
    // Legacy fields (for backward compatibility)
    vatOnIncome,
    vatPaid: vatPaidLast4Quarters,
    vatOutstanding: vatOwedThisQuarter,
    
    // Corporation Tax
    corporationTax,
    corporationTaxRate,
    taxableProfit: Math.round(taxableProfit * 100) / 100,
    
    // Director payments
    davidPayments,
    davidTaxEstimate: Math.round(davidDividendTax * 100) / 100,
    davidTaxBreakdown: {
      dividendTax: Math.round(davidDividendTax * 100) / 100
    },
    heenaPayments,
    heenaTaxEstimate: Math.round(heenaDividendTax * 100) / 100,
    heenaTaxBreakdown: {
      dividendTax: Math.round(heenaDividendTax * 100) / 100
    }
  };
}
