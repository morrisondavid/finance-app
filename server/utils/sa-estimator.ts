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
  calculateNonResidentSaTax,
  type NonResidentSaBasisUsed,
} from '../config/tax-rates.js';
import {
  getDirectorPayroll,
  type DirectorPayroll,
} from '../domain/payroll/index.js';
import {
  getPerson,
  getResidency,
  isNonResidentForTaxYear,
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
import { getSaTaxYearForDate } from './sa-tax-year.js';

export { getSaTaxYearForDate, getSaTaxYearRange } from './sa-tax-year.js';

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
  /** Which residency basis produced the estimate. */
  residencyBasis: NonResidentSaBasisUsed;
  /** True when UK dividends were excluded via disregarded-income treatment. */
  dividendsDisregarded: boolean;
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
  const taxableIncome = round2(salary + dividends + rentalIncome);

  const taxYearStartYear = getSaTaxYearForDate(new Date(`${taxYearStart}T12:00:00`));
  const nonResident = isNonResidentForTaxYear(personId, taxYearStartYear);

  let estimatedTax: number;
  let residencyBasis: NonResidentSaBasisUsed;
  let dividendsDisregarded: boolean;

  if (nonResident) {
    const residency = getResidency(personId);
    const nonResResult = calculateNonResidentSaTax({
      salary,
      dividends,
      rentalIncome,
      retainsPersonalAllowance: residency.retainsPersonalAllowance,
    });
    estimatedTax = nonResResult.tax;
    residencyBasis = nonResResult.basisUsed;
    dividendsDisregarded = nonResResult.dividendsDisregarded;
  } else {
    const dividendTax = calculateDividendTax(dividends, salary);
    const rentalTax = calculateIncomeTaxOnNonDividend(rentalIncome, salary);
    estimatedTax = round2(dividendTax + rentalTax);
    residencyBasis = 'resident';
    dividendsDisregarded = false;
  }

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
    residencyBasis,
    dividendsDisregarded,
  };
}
