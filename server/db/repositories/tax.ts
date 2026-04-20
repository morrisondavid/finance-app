import { getDb } from '../connection.js';
import { formatDateISO } from '../../../shared/date-format.js';
import { buildDashboardFilters, type DashboardFilters } from '../utils/financial-year.js';
import { 
  VAT, 
  calculateCorporationTax, 
  calculateDividendTax,
  getCurrentVatQuarter,
  getVatQuarterForDate,
  type VatQuarterRange
} from '../../config/tax-rates.js';
import {
  getDirectors,
  HMRC_PATTERNS,
  buildHmrcNarrativeCaseSql,
  type HmrcNarrativeKey,
} from '../../config/payees.js';
import { getBusinessPaymentAccounts } from '../../types.js';
import { round2 } from '../../utils/math.js';
import { buildVatAccountFilter, buildCorpTaxAccountFilter } from '../utils/tax-account-filter.js';

export interface HmrcPaymentMatch {
  date: string;
  amount: number;
  account: string;
  description: string;
}

export function findHmrcPayments(opts: {
  patterns: readonly string[];
  accounts: readonly string[];
  startDate: string;
  endDate: string;
}): HmrcPaymentMatch[] {
  const db = getDb();
  const patternCondition = opts.patterns.map(() => 'description LIKE ?').join(' OR ');
  const accountPlaceholders = opts.accounts.map(() => '?').join(',');

  return db.prepare(`
    SELECT date, amount, account, description
    FROM transactions
    WHERE type = 'expense'
    AND (${patternCondition})
    AND account IN (${accountPlaceholders})
    AND date >= ? AND date <= ?
    ORDER BY date ASC
  `).all(...opts.patterns, ...opts.accounts, opts.startDate, opts.endDate) as HmrcPaymentMatch[];
}

/**
 * Narrative category derived from an HMRC payment description. Kept as an
 * internal diagnostic annotation — the Unmatched HMRC Payments UI panel has
 * been removed, but the test suite asserts that every HMRC debit in the
 * rolling window is reconciled to an obligation, and the classification is
 * still useful in the failure message when a seeder regresses.
 *
 *   - `vat`              → `HMRC VAT…` (VAT return settlement)
 *   - `self-assessment`  → `HMRC GOV.UK SA…` (personal tax)
 *   - `corporation-tax`  → `HMRC CORPORATION T…` or `HMRC GOV.UK COTAX…`
 *   - `payment-plan`     → `HMRC NDDS…` or `HMRC ETMP…` (Time-To-Pay
 *     installments, penalty direct debits — mostly picked up by the TTP
 *     auto-seeder; any residual rows are typically one-off penalties or
 *     interest charges that haven't yet established a recurring frequency)
 *   - `other`            → anything else (`HMRC GOV.UK…` with no more
 *     specific prefix, unknown narratives)
 */
/** Alias for {@link HmrcNarrativeKey} kept for call-site clarity. */
export type HmrcNarrativeType = HmrcNarrativeKey;

export interface UnmatchedHmrcPayment extends HmrcPaymentMatch {
  hmrcType: HmrcNarrativeType;
}

/**
 * Internal invariant used by the seeder test suite to assert that every
 * HMRC debit in the rolling window is reconciled to an obligation. NOT
 * exposed via HTTP — the prior `/api/obligations/unmatched-hmrc-payments`
 * endpoint and its UI surface were removed once the VAT / SA / CT / TTP
 * auto-seeders matured to the point where no legitimate orphan should
 * ever survive a startup reseed. When this query returns rows in tests
 * it signals one of:
 *
 *   - a seeder regressed and is no longer matching a pattern it should
 *   - a new HMRC narrative appeared that no seeder handles
 *
 * Linkage is identified by matching the (paid_date, paid_amount,
 * paid_from_account) triple against `financial_obligations`. VAT, SA,
 * CT, and TTP auto-seeders all populate those fields from assigned
 * matches, so their corresponding debits drop off this feed
 * automatically.
 *
 * Each row is annotated with an {@link HmrcNarrativeType} so the test
 * failure message (or ad-hoc diagnostic run) can label the offending row
 * accurately without a second pass over the description.
 *
 * Optional `startDate` / `endDate` narrows the feed to a single calendar
 * window (typically the rolling ±12-month page window). Prior years are
 * settled history — useful in an audit but pure noise when the goal is
 * "is the current pipeline clean right now".
 */
export function findUnmatchedHmrcPayments(opts: {
  patterns: readonly string[];
  accounts: readonly string[];
  startDate?: string;
  endDate?: string;
}): UnmatchedHmrcPayment[] {
  const db = getDb();
  const patternCondition = opts.patterns.map(() => 't.description LIKE ?').join(' OR ');
  const accountPlaceholders = opts.accounts.map(() => '?').join(',');

  const dateClauses: string[] = [];
  const dateParams: string[] = [];
  if (opts.startDate) {
    dateClauses.push('t.date >= ?');
    dateParams.push(opts.startDate);
  }
  if (opts.endDate) {
    dateClauses.push('t.date <= ?');
    dateParams.push(opts.endDate);
  }
  const dateFilter = dateClauses.length > 0 ? ` AND ${dateClauses.join(' AND ')}` : '';

  return db.prepare(`
    SELECT
      t.date,
      t.amount,
      t.account,
      t.description,
      ${buildHmrcNarrativeCaseSql('t.description')} AS hmrcType
    FROM transactions t
    WHERE t.type = 'expense'
      AND (${patternCondition})
      AND t.account IN (${accountPlaceholders})${dateFilter}
      AND NOT EXISTS (
        SELECT 1 FROM financial_obligations o
        WHERE o.paid_date = t.date
          AND ABS(o.paid_amount - ABS(t.amount)) < 0.01
          AND (o.paid_from_account = t.account OR o.paid_from_account LIKE '%' || t.account || '%')
      )
    ORDER BY t.date ASC
  `).all(...opts.patterns, ...opts.accounts, ...dateParams) as UnmatchedHmrcPayment[];
}

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
 * Minimal DB shape this module uses for the helper. Narrower than the full
 * better-sqlite3 Database type so shared callers (e.g. sa-estimator) can
 * inject an in-memory test double without importing sqlite types.
 */
export interface DirectorPaymentsDb {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}

/**
 * Salary and dividend lines paid from the business (outbound expenses) for a
 * single director, classified by proximity to their configured
 * `monthlySalary`. Director payouts are not business-to-business transfers,
 * so they remain `expense` in the ledger.
 *
 * Exported so shared modules (e.g. `sa-estimator`) can reuse the same logic
 * without reimplementing salary vs. dividend classification SQL.
 */
export function getDirectorPayments(
  db: DirectorPaymentsDb,
  namePattern: string,
  monthlySalary: number,
  tolerance: number,
  clause: string,
  params: string[],
): { salary: number; dividends: number; total: number; annualSalary: number } {
  const outboundExpense = `
    type = 'expense'
    AND amount < 0
    AND description LIKE ?
  `;

  // A debit is "salary-like" when its absolute amount sits within
  // `tolerance` of the configured monthly figure. Anything else on the
  // same narrative falls into the dividends bucket — covers both
  // bonus-style payroll top-ups and the usual dividend debits.
  const salaryResult = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as total
    FROM transactions
    WHERE ${outboundExpense}
    AND ABS(ABS(amount) - ?) <= ?
    ${clause}
  `).get(namePattern, monthlySalary, tolerance, ...params) as { total: number };

  const dividendResult = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as total
    FROM transactions
    WHERE ${outboundExpense}
    AND ABS(ABS(amount) - ?) > ?
    ${clause}
  `).get(namePattern, monthlySalary, tolerance, ...params) as { total: number };

  const salary = round2(salaryResult.total);
  const dividends = round2(dividendResult.total);

  return {
    salary,
    dividends,
    total: salary + dividends,
    annualSalary: monthlySalary * 12,
  };
}

/** Delegates to calculateDividendTax in tax-rates (one implementation, tested there). */
function calculateDirectorDividendTax(salaryPaidInPeriod: number, dividends: number): number {
  return calculateDividendTax(dividends, salaryPaidInPeriod);
}

/**
 * Calculate UK tax liabilities based on income
 * 
 * VAT: 20% of net income (assuming VAT registered, income is VAT-inclusive)
 * Corporation Tax: 19% for profits under £50k, 25% for over £250k, marginal between
 *   - Calculated on income only (expenses are NOT deducted)
 *   - This provides a conservative/worst-case tax liability estimate
 * Director personal: dividend tax estimate vs salary paid in the selected period (PAYE on salary excluded).
 */
export function getTaxLiabilities(filters: DashboardFilters = {}): TaxLiabilities {
  const db = getDb();
  const { clause, params } = buildDashboardFilters(filters);
  const corpTaxFilter = buildCorpTaxAccountFilter();
  const vatFilter = buildVatAccountFilter();
  
  // Get income for the selected financial year (for Corp Tax) — always scoped to corpTax accounts
  const incomeResult = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'income'${clause} ${corpTaxFilter.clause}
  `).get(...params, ...corpTaxFilter.params) as { total: number };
  
  const income = incomeResult.total;
  
  // VAT calculation - use current VAT QUARTER, not financial year
  const vatQuarter = getCurrentVatQuarter();
  
  // Get income for the current VAT quarter only — scoped to VAT-applicable accounts
  const vatQuarterIncomeResult = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total 
    FROM transactions 
    WHERE type = 'income'
    AND date >= ? AND date <= ? ${vatFilter.clause}
  `).get(vatQuarter.startDate, vatQuarter.endDate, ...vatFilter.params) as { total: number };
  
  const vatQuarterIncome = vatQuarterIncomeResult.total;
  const vatOwedThisQuarter = round2(vatQuarterIncome * VAT.FRACTION);
  
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
      AND date >= ? AND date <= ? ${vatFilter.clause}
    `).get(calendarQuarter.startDate, calendarQuarter.endDate, ...vatFilter.params) as { total: number };
    vatInProgressEstimate = round2(inProgressIncomeResult.total * VAT.FRACTION);
  }
  
  // Legacy: VAT on income for the FY (still needed for some displays)
  const vatOnIncome = round2(income * VAT.FRACTION);
  
  // Get VAT already paid to HMRC (rolling 12 months / 4 quarters)
  const today = new Date();
  const twelveMonthsAgo = new Date(today);
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

  const vatPayments = findHmrcPayments({
    patterns: HMRC_PATTERNS.VAT,
    accounts: getBusinessPaymentAccounts(),
    startDate: formatDateISO(twelveMonthsAgo),
    endDate: formatDateISO(today),
  });
  const vatPaidLast4Quarters = round2(
    vatPayments.reduce((sum, p) => sum + Math.abs(p.amount), 0),
  );
  
  const directors = getDirectors();
  const david = directors.find(d => d.id === 'david');
  const heena = directors.find(d => d.id === 'heena');

  const davidPayments = david
    ? getDirectorPayments(db, david.namePattern, david.monthlySalary, david.tolerance, clause, params)
    : { salary: 0, dividends: 0, total: 0, annualSalary: 0 };

  const heenaPayments = heena
    ? getDirectorPayments(db, heena.namePattern, heena.monthlySalary, heena.tolerance, clause, params)
    : { salary: 0, dividends: 0, total: 0, annualSalary: 0 };
  
  // Corporation Tax calculation
  // Taxable profit = Income (net of VAT) only - expenses NOT deducted (conservative estimate)
  const incomeNetOfVat = income - vatOnIncome;
  const taxableProfit = Math.max(0, incomeNetOfVat);
  
  const corpTax = calculateCorporationTax(taxableProfit);
  const corporationTax = round2(corpTax.tax);
  const corporationTaxRate = Math.round(corpTax.effectiveRate * 10000) / 100; // as percentage
  
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
    taxableProfit: round2(taxableProfit),
    
    // Director payments
    davidPayments,
    davidTaxEstimate: round2(davidDividendTax),
    davidTaxBreakdown: {
      dividendTax: round2(davidDividendTax)
    },
    heenaPayments,
    heenaTaxEstimate: round2(heenaDividendTax),
    heenaTaxBreakdown: {
      dividendTax: round2(heenaDividendTax)
    }
  };
}
