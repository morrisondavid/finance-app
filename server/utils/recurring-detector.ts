/**
 * Classifies merchant-level spending as "monthly" or "annual" recurring
 * subscriptions using strict heuristics: consistent amounts, consistent
 * billing dates, and recency (must still be active).
 *
 * Pure function — no IO, fully testable.
 */

import type { RecurringExpense, RecurringFrequency } from '../../shared/api-contracts.js';
import { categoryColour } from './categorizer.js';
import type { CategoryName } from './categorizer.js';
import { SPECIAL_CATEGORY } from './category-constants.js';
import { getMerchantLogoUrl } from './merchant-logos.js';
import { round2 } from './math.js';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Day-of-month circular stats use a fixed 30-day period (approximation; months are not equal length). */
function circularDayStddev(days: number[]): number {
  if (days.length < 2) return 0;
  const period = 30;
  const angles = days.map(d => (2 * Math.PI * d) / period);
  const sinSum = angles.reduce((s, a) => s + Math.sin(a), 0) / angles.length;
  const cosSum = angles.reduce((s, a) => s + Math.cos(a), 0) / angles.length;
  const R = Math.sqrt(sinSum ** 2 + cosSum ** 2);
  const circStdRad = Math.sqrt(-2 * Math.log(Math.max(R, 1e-10)));
  return (circStdRad * period) / (2 * Math.PI);
}

/** Whole-day distance between two ISO date strings (UTC, calendar semantics). */
function daysBetweenIso(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const ams = Date.UTC(ay, am - 1, ad);
  const bms = Date.UTC(by, bm - 1, bd);
  return Math.round((bms - ams) / (24 * 60 * 60 * 1000));
}

/** Circular mean of day-of-month values, returned as an integer day (1-30). */
function circularMeanDay(days: number[]): number {
  if (days.length === 0) return 1;
  const period = 30;
  const angles = days.map(d => (2 * Math.PI * d) / period);
  const sinMean = angles.reduce((s, a) => s + Math.sin(a), 0) / angles.length;
  const cosMean = angles.reduce((s, a) => s + Math.cos(a), 0) / angles.length;
  let meanAngle = Math.atan2(sinMean, cosMean);
  if (meanAngle < 0) meanAngle += 2 * Math.PI;
  return Math.round((meanAngle * period) / (2 * Math.PI)) || 1;
}

/** Circular mean of month numbers (1-12). */
function circularMeanMonth(months: number[]): number {
  if (months.length === 0) return 1;
  const period = 12;
  const angles = months.map(m => (2 * Math.PI * m) / period);
  const sinMean = angles.reduce((s, a) => s + Math.sin(a), 0) / angles.length;
  const cosMean = angles.reduce((s, a) => s + Math.cos(a), 0) / angles.length;
  let meanAngle = Math.atan2(sinMean, cosMean);
  if (meanAngle < 0) meanAngle += 2 * Math.PI;
  return Math.round((meanAngle * period) / (2 * Math.PI)) || 1;
}

export interface TransactionDetail {
  date: string;   // "YYYY-MM-DD"
  amount: number;  // always positive (absolute)
}

export interface RecurringCandidate {
  merchant: string;
  category: CategoryName;
  sourceAccount: string;
  accountCategory: 'personal' | 'business';
  monthlyMax: number;
  monthlyAvg: number;
  monthsActive: number;
  annualTotal: number;
  transactions: TransactionDetail[];
  /**
   * Set by the pipeline when this candidate matches a FIXED_BILL_OVERRIDES
   * entry with `relaxedMinMonths`. Unlocks the declared-fixed relaxation
   * branch in {@link classifyRecurring}.
   */
  isDeclaredFixed?: boolean;
}

export interface RecurringClassification {
  monthly: RecurringExpense[];
  annual: RecurringExpense[];
}

// ─── Monthly thresholds ──────────────────────────────────────────────
const MONTHLY_MIN_MONTHS_RATIO = 0.5;
const MONTHLY_AMOUNT_CV_MAX = 0.35;
const MONTHLY_DAY_STDDEV_MAX = 7;
const MONTHLY_STALE_MONTHS = 2;

const SEASONAL_BILLING_EXCEPTIONS = [
  /council\s*tax/i,
];

// ─── Property income (rental) — relaxed thresholds ───────────────────
const PROPERTY_INCOME_MIN_MONTHS = 2;
const PROPERTY_INCOME_AMOUNT_CV_MAX = 0.60;

// ─── Declared fixed bills (FIXED_BILL_OVERRIDES) — relaxed thresholds ─
// A candidate explicitly declared as a fixed monthly bill in config is the
// single source of truth that it's recurring — the detector should not
// gatekeep on history length. We surface it after the first payment
// (the config itself is the signal), tolerate wider amount variance
// (e.g. VAT-inclusive accountant fees), and skip the day-of-month spread
// check since invoice-driven payment dates commonly drift by a week or two.
const DECLARED_FIXED_MIN_MONTHS = 1;
const DECLARED_FIXED_AMOUNT_CV_MAX = 0.60;

// ─── Annual thresholds ───────────────────────────────────────────────
const ANNUAL_MIN_YEARS_EXACT = 2;  // enough if amounts are identical
const ANNUAL_MIN_YEARS_VARIED = 3; // need more evidence when amounts differ
const ANNUAL_AMOUNT_CV_MAX = 0.50; // picks can vary more than monthly (price changes)
// Only surface annuals whose most recent yearly charge is >= this. Keeps
// insurance / AppleCare / domain-bundle renewals; drops ad-hoc shopping
// coincidences and monthly subs misclassified via CV.
const ANNUAL_MIN_RECENT_AMOUNT = 90;
// Every consecutive pair of yearly picks must land within 365 +/- this many
// days so we only accept genuinely-annual cadences and reject cross-month
// coincidences (e.g. 5 Jan one year and 3 Feb the next).
const ANNUAL_GAP_TOLERANCE_DAYS = 14;

function monthsAgo(referenceDate: Date, n: number): string {
  const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function areConsecutiveYears(years: number[]): boolean {
  if (years.length < 2) return false;
  const sorted = [...years].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] !== 1) return false;
  }
  return true;
}

/**
 * For annual detection: pick one representative transaction per year.
 * Uses the largest transaction in each year as the likely subscription renewal.
 */
function pickAnnualCandidates(transactions: TransactionDetail[]): TransactionDetail[] {
  const byYear = new Map<number, TransactionDetail[]>();
  for (const t of transactions) {
    const year = parseInt(t.date.slice(0, 4), 10);
    const bucket = byYear.get(year) ?? [];
    bucket.push(t);
    byYear.set(year, bucket);
  }

  const candidates: TransactionDetail[] = [];
  for (const txns of byYear.values()) {
    txns.sort((a, b) => b.amount - a.amount);
    candidates.push(txns[0]);
  }
  return candidates;
}

export function classifyRecurring(
  candidates: RecurringCandidate[],
  monthsCovered: number,
  referenceDate: Date = new Date(),
  isIncome = false,
): RecurringClassification {
  const effectiveMonths = Math.max(monthsCovered, 1);
  const monthlyThreshold = Math.ceil(effectiveMonths * MONTHLY_MIN_MONTHS_RATIO);
  const staleAfter = monthsAgo(referenceDate, MONTHLY_STALE_MONTHS);

  const monthly: RecurringExpense[] = [];
  const annual: RecurringExpense[] = [];

  for (const c of candidates) {
    const isPropertyIncome = isIncome && c.category === SPECIAL_CATEGORY.property;
    const isDeclaredFixed = c.isDeclaredFixed === true;

    // Declared fixed bills are config-driven: one payment is enough to
    // surface them because the declaration itself is the recurrence signal.
    // All other candidates still need ≥2 transactions to be considered
    // recurring at all.
    if (!isDeclaredFixed && c.transactions.length < 2) continue;
    if (c.transactions.length < 1) continue;

    const amounts = c.transactions.map(t => t.amount);
    const days = c.transactions.map(t => new Date(t.date).getDate());
    const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    const amountCV = mean > 0 ? stddev(amounts) / mean : Infinity;

    // Property income uses max (gross rent before agent deductions); everything else uses median
    const typicalAmount = isPropertyIncome ? Math.max(...amounts) : median(amounts);

    // ── Monthly test ──────────────────────────────────────────────
    let classifiedAsMonthly = false;

    let minMonths = monthlyThreshold;
    let maxCV = MONTHLY_AMOUNT_CV_MAX;
    if (isPropertyIncome) {
      minMonths = PROPERTY_INCOME_MIN_MONTHS;
      maxCV = PROPERTY_INCOME_AMOUNT_CV_MAX;
    } else if (isDeclaredFixed) {
      minMonths = DECLARED_FIXED_MIN_MONTHS;
      maxCV = DECLARED_FIXED_AMOUNT_CV_MAX;
    }

    if (c.monthsActive >= minMonths) {
      const daySD = circularDayStddev(days);
      // Declared fixed bills skip the day-of-month spread gate (invoice-driven
      // payments can legitimately land a week or two apart month to month).
      const dayOk = isDeclaredFixed || daySD <= MONTHLY_DAY_STDDEV_MAX;
      if (amountCV <= maxCV && dayOk) {
        let stale = false;
        // Property income skips staleness check
        if (!isPropertyIncome) {
          const isSeasonalException = SEASONAL_BILLING_EXCEPTIONS.some(p => p.test(c.merchant));
          if (!isSeasonalException) {
            const lastTxMonth = c.transactions
              .map(t => t.date.slice(0, 7))
              .sort()
              .pop()!;
            stale = lastTxMonth < staleAfter;
          }
        }
        if (!stale) {
          const avgDay = circularMeanDay(days);
          monthly.push(toExpense(c, 'monthly', typicalAmount, avgDay, null));
          classifiedAsMonthly = true;
        }
      }
    }
    if (classifiedAsMonthly) continue;

    // ── Annual test ───────────────────────────────────────────────
    // Pick the largest charge per year as the likely subscription renewal,
    // sorted ascending by date so we can both reason about consecutive-year
    // gaps and identify the most recent pick (used for the amount gate and
    // for display).
    const annualPicks = pickAnnualCandidates(c.transactions)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (annualPicks.length < 2) continue;

    const mostRecentPick = annualPicks[annualPicks.length - 1];
    if (mostRecentPick.amount < ANNUAL_MIN_RECENT_AMOUNT) continue;

    const pickYears = annualPicks.map(t => parseInt(t.date.slice(0, 4), 10));
    if (!areConsecutiveYears(pickYears)) continue;

    const pickAmounts = annualPicks.map(t => t.amount);
    const exactMatch = new Set(pickAmounts.map(a => round2(a))).size === 1;
    const minYears = exactMatch ? ANNUAL_MIN_YEARS_EXACT : ANNUAL_MIN_YEARS_VARIED;
    if (pickYears.length < minYears) continue;

    const pickMean = pickAmounts.reduce((s, v) => s + v, 0) / pickAmounts.length;
    const pickCV = pickMean > 0 ? stddev(pickAmounts) / pickMean : Infinity;
    if (pickCV > ANNUAL_AMOUNT_CV_MAX) continue;

    // Require every consecutive pair to be ~365 days apart so we only accept
    // genuine year-on-year cadences. Naturally accounts for leap years.
    let gapsOk = true;
    for (let i = 1; i < annualPicks.length; i++) {
      const gapDays = daysBetweenIso(annualPicks[i - 1].date, annualPicks[i].date);
      if (Math.abs(gapDays - 365) > ANNUAL_GAP_TOLERANCE_DAYS) {
        gapsOk = false;
        break;
      }
    }
    if (!gapsOk) continue;

    const pickMonths = annualPicks.map(t => new Date(t.date).getMonth() + 1);
    const pickDays = annualPicks.map(t => new Date(t.date).getDate());
    const avgMonth = circularMeanMonth(pickMonths);
    const avgDay = circularMeanDay(pickDays);
    annual.push(toExpense(c, 'annual', mostRecentPick.amount, avgDay, avgMonth));
  }

  monthly.sort((a, b) => b.amount - a.amount);
  annual.sort((a, b) => b.annualTotal - a.annualTotal);

  return { monthly, annual };
}

function toExpense(
  c: RecurringCandidate,
  frequency: RecurringFrequency,
  displayAmount: number,
  billingDayOfMonth: number | null,
  billingMonth: number | null,
): RecurringExpense {
  return {
    merchant: c.merchant,
    category: c.category,
    colour: categoryColour(c.category),
    amount: round2(displayAmount),
    frequency,
    monthsActive: c.monthsActive,
    annualTotal: round2(c.annualTotal),
    logoUrl: getMerchantLogoUrl(c.merchant),
    sourceAccount: c.sourceAccount,
    billingDayOfMonth,
    billingMonth,
  };
}
