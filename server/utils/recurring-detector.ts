/**
 * Classifies merchant-level spending as "monthly" or "annual" recurring
 * subscriptions using strict heuristics: consistent amounts, consistent
 * billing dates, and recency (must still be active).
 *
 * Pure function — no IO, fully testable.
 */

import type { RecurringExpense, RecurringFrequency } from '../../shared/api-contracts.js';
import { CATEGORY_COLOURS } from './categorizer.js';
import type { CategoryName } from './categorizer.js';
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

function circularMonthStddev(months: number[]): number {
  if (months.length < 2) return 0;
  const period = 12;
  const angles = months.map(m => (2 * Math.PI * m) / period);
  const sinSum = angles.reduce((s, a) => s + Math.sin(a), 0) / angles.length;
  const cosSum = angles.reduce((s, a) => s + Math.cos(a), 0) / angles.length;
  const R = Math.sqrt(sinSum ** 2 + cosSum ** 2);
  const circStdRad = Math.sqrt(-2 * Math.log(Math.max(R, 1e-10)));
  return (circStdRad * period) / (2 * Math.PI);
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

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface TransactionDetail {
  date: string;   // "YYYY-MM-DD"
  amount: number;  // always positive (absolute)
}

export interface RecurringCandidate {
  merchant: string;
  category: CategoryName;
  sourceAccount: string;
  ownership: 'personal' | 'business';
  monthlyMax: number;
  monthlyAvg: number;
  monthsActive: number;
  annualTotal: number;
  transactions: TransactionDetail[];
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

// ─── Annual thresholds ───────────────────────────────────────────────
const ANNUAL_MIN_YEARS_EXACT = 2;  // enough if amounts are identical
const ANNUAL_MIN_YEARS_VARIED = 3; // need more evidence when amounts differ
const ANNUAL_MONTH_STDDEV_MAX = 1.5;
const ANNUAL_DAY_STDDEV_MAX = 5;
const ANNUAL_AMOUNT_CV_MAX = 0.50; // picks can vary more than monthly (price changes)
const ANNUAL_MIN_AMOUNT = 5;

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
): RecurringClassification {
  const effectiveMonths = Math.max(monthsCovered, 1);
  const monthlyThreshold = Math.ceil(effectiveMonths * MONTHLY_MIN_MONTHS_RATIO);
  const staleAfter = monthsAgo(referenceDate, MONTHLY_STALE_MONTHS);

  const monthly: RecurringExpense[] = [];
  const annual: RecurringExpense[] = [];

  for (const c of candidates) {
    if (c.transactions.length < 2) continue;

    const amounts = c.transactions.map(t => t.amount);
    const days = c.transactions.map(t => new Date(t.date).getDate());
    const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    const amountCV = mean > 0 ? stddev(amounts) / mean : Infinity;
    const typicalAmount = median(amounts);

    // ── Monthly test ──────────────────────────────────────────────
    let classifiedAsMonthly = false;
    if (c.monthsActive >= monthlyThreshold) {
      const daySD = circularDayStddev(days);
      if (amountCV <= MONTHLY_AMOUNT_CV_MAX && daySD <= MONTHLY_DAY_STDDEV_MAX) {
        let stale = false;
        const isSeasonalException = SEASONAL_BILLING_EXCEPTIONS.some(p => p.test(c.merchant));
        if (!isSeasonalException) {
          const lastTxMonth = c.transactions
            .map(t => t.date.slice(0, 7))
            .sort()
            .pop()!;
          stale = lastTxMonth < staleAfter;
        }
        if (!stale) {
          const avgDay = circularMeanDay(days);
          monthly.push(toExpense(c, 'monthly', typicalAmount, `~${ordinal(avgDay)} of each month`));
          classifiedAsMonthly = true;
        }
      }
    }
    if (classifiedAsMonthly) continue;

    // ── Annual test ───────────────────────────────────────────────
    // Pick the largest charge per year as the likely subscription renewal
    const annualPicks = pickAnnualCandidates(c.transactions);
    if (annualPicks.some(t => t.amount < ANNUAL_MIN_AMOUNT)) continue;
    const pickYears = annualPicks.map(t => parseInt(t.date.slice(0, 4), 10));
    if (!areConsecutiveYears(pickYears)) continue;

    const pickAmounts = annualPicks.map(t => t.amount);
    const exactMatch = new Set(pickAmounts.map(a => round2(a))).size === 1;
    const minYears = exactMatch ? ANNUAL_MIN_YEARS_EXACT : ANNUAL_MIN_YEARS_VARIED;
    if (pickYears.length < minYears) continue;

    const pickMean = pickAmounts.reduce((s, v) => s + v, 0) / pickAmounts.length;
    const pickCV = pickMean > 0 ? stddev(pickAmounts) / pickMean : Infinity;
    if (pickCV > ANNUAL_AMOUNT_CV_MAX) continue;

    const pickMonths = annualPicks.map(t => new Date(t.date).getMonth() + 1);
    const pickDays = annualPicks.map(t => new Date(t.date).getDate());
    const monthSD = circularMonthStddev(pickMonths);
    const daySD = circularDayStddev(pickDays);

    if (monthSD <= ANNUAL_MONTH_STDDEV_MAX && daySD <= ANNUAL_DAY_STDDEV_MAX) {
      const mostRecentPick = annualPicks.sort((a, b) => b.date.localeCompare(a.date))[0];
      const avgMonth = circularMeanMonth(pickMonths);
      const avgDay = circularMeanDay(pickDays);
      const billingLabel = `~${ordinal(avgDay)} ${MONTH_NAMES[avgMonth]}`;
      annual.push(toExpense(c, 'annual', mostRecentPick.amount, billingLabel));
    }
  }

  monthly.sort((a, b) => b.amount - a.amount);
  annual.sort((a, b) => b.annualTotal - a.annualTotal);

  return { monthly, annual };
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function toExpense(
  c: RecurringCandidate,
  frequency: RecurringFrequency,
  displayAmount: number,
  billingDay: string | null,
): RecurringExpense {
  return {
    merchant: c.merchant,
    category: c.category,
    colour: CATEGORY_COLOURS[c.category] ?? '#6B7280',
    amount: round2(displayAmount),
    frequency,
    monthsActive: c.monthsActive,
    annualTotal: round2(c.annualTotal),
    logoUrl: getMerchantLogoUrl(c.merchant),
    sourceAccount: c.sourceAccount,
    billingDay,
  };
}
