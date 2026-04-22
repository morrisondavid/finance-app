/**
 * Self Assessment estimator.
 *
 * Computes an indicative annual Self Assessment tax bill for a single
 * person, combining director payments (salary + dividends) with their share
 * of rental income. The math reuses the dividend and band-based income-tax
 * calculators in `tax-rates.ts` so dashboard and obligations code paths
 * always agree on the number.
 *
 * V1 purpose: seed auto Self Assessment obligations on the Obligations page
 * with a pre-filled estimate. The manual obligation a user adds later
 * supersedes this figure; the estimator never feeds the final HMRC return.
 */

import {
  calculateDividendTax,
  calculateIncomeTaxOnNonDividend,
} from '../config/tax-rates.js';
import {
  getDirectorPayroll,
  type DirectorPayroll,
} from '../domain/payroll/index.js';
import {
  getPerson,
  personShortName,
  type PersonId,
} from '../domain/people/index.js';
import {
  sumRentalIncomeForPerson,
} from '../domain/obligations/rental-income.js';
import {
  getDirectorPayments,
  type DirectorPaymentsDb,
} from '../db/repositories/tax.js';
import { round2 } from './math.js';

/**
 * Shape of the DB handle used by the estimator. Shared with
 * {@link getDirectorPayments} so tests can inject a single in-memory double.
 */
type PreparableDb = DirectorPaymentsDb;

export interface SaEstimate {
  personId: PersonId;
  displayName: string;
  /** Tax year start (inclusive), ISO date. */
  taxYearStart: string;
  /** Tax year end (inclusive), ISO date. */
  taxYearEnd: string;
  /** Annual salary attributed to this person in the tax year. */
  salary: number;
  /** Annual dividends attributed to this person in the tax year. */
  dividends: number;
  /** Rental income attributable to this person (after ownership split). */
  rentalIncome: number;
  /** Sum of all attributable income, rounded. */
  taxableIncome: number;
  /** Combined dividend + rental income tax estimate. */
  estimatedTax: number;
}

/**
 * UK Self Assessment tax years run 6 April → 5 April. Given a "tax year
 * start year" (the calendar year in which 6 Apr falls), return the ISO
 * boundaries. Returns strings so date comparisons stay string-based.
 */
export function getSaTaxYearRange(startYear: number): { start: string; end: string } {
  const start = `${startYear}-04-06`;
  const end = `${startYear + 1}-04-05`;
  return { start, end };
}

/**
 * Determine the tax year containing a given date (inclusive).
 * Example: 2026-03-31 → startYear 2025; 2026-04-06 → startYear 2026.
 */
export function getSaTaxYearForDate(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  if (month < 3 || (month === 3 && day < 6)) {
    return year - 1;
  }
  return year;
}

/**
 * Compute a SA estimate for a person across the given ISO date window.
 *
 * The date window is typically the UK tax year (6 Apr → 5 Apr) — callers
 * pass exactly the boundaries they care about so this function does not
 * care which calendar year convention is in play.
 */
export function estimateSaForPerson(
  personId: PersonId,
  taxYearStart: string,
  taxYearEnd: string,
  db: PreparableDb,
): SaEstimate {
  const person = getPerson(personId);
  const payroll: DirectorPayroll | undefined = getDirectorPayroll(personId);

  const clause = 'AND date >= ? AND date <= ?';
  const params: string[] = [taxYearStart, taxYearEnd];

  const directorPayments = payroll
    ? getDirectorPayments(
        db,
        payroll.namePattern,
        payroll.monthlySalary,
        payroll.tolerance,
        clause,
        params,
      )
    : { salary: 0, dividends: 0, total: 0, annualSalary: 0 };

  const rentalIncome = round2(
    sumRentalIncomeForPerson(db, personId, taxYearStart, taxYearEnd),
  );

  const salary = round2(directorPayments.salary);
  const dividends = round2(directorPayments.dividends);

  const dividendTax = calculateDividendTax(dividends, salary);
  const rentalTax = calculateIncomeTaxOnNonDividend(rentalIncome, salary);

  const taxableIncome = round2(salary + dividends + rentalIncome);
  const estimatedTax = round2(dividendTax + rentalTax);

  return {
    personId,
    displayName: personShortName(person),
    taxYearStart,
    taxYearEnd,
    salary,
    dividends,
    rentalIncome,
    taxableIncome,
    estimatedTax,
  };
}
