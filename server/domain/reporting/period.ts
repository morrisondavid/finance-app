import type { ReportingRegime } from '../../../shared/api-contracts.js';
import { getVatQuarterForDate } from '../../config/tax-rates.js';
import {
  getFinancialYearForDate,
  getFinancialYearRange,
  listMonthKeysInFinancialYear,
  normalizeFinancialYear,
} from '../../db/utils/financial-year.js';
import { getQuarterMonths } from '../statements/statement-files-catalog.js';

export interface ReportingPeriod {
  regime: ReportingRegime;
  label: string;
  monthKeys: string[];
  startDate: string;
  endDate: string;
}

/** Canonical Q{n}-YYYY label (YYYY = end-date calendar year), reusing the tax-rates calendar. */
export function vatQuarterLabel(range: { quarter: number; endDate: string }): string {
  return `Q${range.quarter}-${new Date(range.endDate).getFullYear()}`;
}

export function mostRecentlyEndedVatQuarterLabel(today: Date = new Date()): string {
  const currentQuarter = getVatQuarterForDate(today);
  const previousQuarterDate = new Date(currentQuarter.startDate);
  previousQuarterDate.setDate(previousQuarterDate.getDate() - 1);
  const previousQuarter = getVatQuarterForDate(previousQuarterDate);
  return vatQuarterLabel(previousQuarter);
}

export function mostRecentlyEndedFyLabel(today: Date = new Date()): string {
  const currentFy = getFinancialYearForDate(today);
  const currentRange = getFinancialYearRange(currentFy);
  const dayBeforeFyStart = new Date(currentRange.startDate);
  dayBeforeFyStart.setDate(dayBeforeFyStart.getDate() - 1);
  return getFinancialYearForDate(dayBeforeFyStart);
}

function lastDayOfMonthKey(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const lastDay = new Date(year, month, 0).getDate();
  return `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
}

function resolveVatPeriod(periodLabel: string): ReportingPeriod {
  const months = getQuarterMonths(periodLabel);
  if (months.length === 0) {
    throw new Error(`Invalid VAT period label: ${periodLabel}`);
  }
  const monthKeys = months.map(
    ({ year, month }) => `${year}-${String(month).padStart(2, '0')}`,
  );
  const startDate = `${monthKeys[0]}-01`;
  const endDate = lastDayOfMonthKey(monthKeys[monthKeys.length - 1]);
  return {
    regime: 'vat',
    label: periodLabel,
    monthKeys,
    startDate,
    endDate,
  };
}

function resolveCtPeriod(periodLabel: string): ReportingPeriod {
  const normalized = normalizeFinancialYear(periodLabel);
  if (!/^\d{4}\/\d{2}$/.test(normalized)) {
    throw new Error(`Invalid corporation tax period label: ${periodLabel}`);
  }
  const range = getFinancialYearRange(normalized);
  const monthKeys = listMonthKeysInFinancialYear(normalized);
  return {
    regime: 'corporation_tax',
    label: range.label,
    monthKeys,
    startDate: range.startDate,
    endDate: range.endDate,
  };
}

const DATE_RANGE_LABEL = /^(\d{4}-\d{2})_(\d{4}-\d{2})$/;
const MAX_DATE_RANGE_MONTHS = 24;

function isValidMonthKey(monthKey: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

function listMonthKeysInclusive(fromMonthKey: string, toMonthKey: string): string[] {
  const keys: string[] = [];
  const [startYear, startMonth] = fromMonthKey.split('-').map(Number);
  let year = startYear;
  let month = startMonth;
  let key = `${year}-${String(month).padStart(2, '0')}`;
  while (key <= toMonthKey) {
    keys.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    key = `${year}-${String(month).padStart(2, '0')}`;
  }
  return keys;
}

function resolveDateRangePeriod(periodLabel: string): ReportingPeriod {
  const match = DATE_RANGE_LABEL.exec(periodLabel);
  if (!match || !isValidMonthKey(match[1]) || !isValidMonthKey(match[2])) {
    throw new Error(`Invalid date range period label: ${periodLabel}`);
  }
  const fromMonthKey = match[1];
  const toMonthKey = match[2];
  if (fromMonthKey > toMonthKey) {
    throw new Error(`Invalid date range: start after end (${periodLabel})`);
  }
  const monthKeys = listMonthKeysInclusive(fromMonthKey, toMonthKey);
  if (monthKeys.length > MAX_DATE_RANGE_MONTHS) {
    throw new Error(
      `Invalid date range: ${monthKeys.length} months exceeds the ${MAX_DATE_RANGE_MONTHS}-month limit`,
    );
  }
  return {
    regime: 'date_range',
    label: periodLabel,
    monthKeys,
    startDate: `${fromMonthKey}-01`,
    endDate: lastDayOfMonthKey(toMonthKey),
  };
}

export function resolveReportingPeriod(
  regime: ReportingRegime,
  periodLabel: string,
): ReportingPeriod {
  const trimmed = periodLabel.trim();
  if (regime === 'vat') {
    return resolveVatPeriod(trimmed);
  }
  if (regime === 'corporation_tax') {
    return resolveCtPeriod(trimmed);
  }
  return resolveDateRangePeriod(trimmed);
}

export interface VatQuarterDescriptor {
  periodLabel: string;
  periodStartDate: string;
  periodEndDate: string;
  dueDate: string;
  humanLabel: string;
}

/** The Stagger-2 VAT quarters whose date range overlaps the May–Apr financial year. */
export function listVatQuarterDescriptorsInFinancialYear(fy: string): VatQuarterDescriptor[] {
  const monthKeys = listMonthKeysInFinancialYear(fy);
  const seen = new Set<string>();
  const out: VatQuarterDescriptor[] = [];
  for (const key of monthKeys) {
    const [year, month] = key.split('-').map(Number);
    const range = getVatQuarterForDate(new Date(year, month - 1, 15));
    const periodLabel = vatQuarterLabel(range);
    if (seen.has(periodLabel)) continue;
    seen.add(periodLabel);
    out.push({
      periodLabel,
      periodStartDate: range.startDate,
      periodEndDate: range.endDate,
      dueDate: range.dueDate,
      humanLabel: range.label,
    });
  }
  return out;
}

export function listVatQuarterLabelsInFinancialYear(fy: string): string[] {
  return listVatQuarterDescriptorsInFinancialYear(fy).map(d => d.periodLabel);
}

/** UK CT deadline: financial-year end + 9 months + 1 day (e.g. 2025/26 → 2027-01-31). */
export function corporationTaxDueDateForFy(fy: string): string {
  const range = getFinancialYearRange(fy);
  const [y, m, d] = range.endDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + 9);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

export interface DueReportingPeriod {
  regime: ReportingRegime;
  periodLabel: string;
  dueDate: string;
  periodStartDate: string;
  periodEndDate: string;
}

/** VAT quarters + CT financial years whose filing deadline falls in (today, today+horizonDays]. */
export function listReportingPeriodsDueWithinHorizon(
  horizonDays: number,
  today: Date = new Date(),
): DueReportingPeriod[] {
  const horizonEnd = new Date(today);
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);
  const todayIso = today.toISOString().slice(0, 10);
  const horizonIso = horizonEnd.toISOString().slice(0, 10);
  const result: DueReportingPeriod[] = [];

  const seenVat = new Set<string>();
  for (let offsetMonths = -6; offsetMonths <= 12; offsetMonths += 1) {
    const probe = new Date(today);
    probe.setMonth(probe.getMonth() + offsetMonths);
    const range = getVatQuarterForDate(probe);
    const periodLabel = vatQuarterLabel(range);
    if (seenVat.has(periodLabel)) continue;
    seenVat.add(periodLabel);
    if (range.dueDate > todayIso && range.dueDate <= horizonIso) {
      result.push({
        regime: 'vat',
        periodLabel,
        dueDate: range.dueDate,
        periodStartDate: range.startDate,
        periodEndDate: range.endDate,
      });
    }
  }

  const ctFys = new Set([mostRecentlyEndedFyLabel(today), getFinancialYearForDate(today)]);
  for (const fy of ctFys) {
    const range = getFinancialYearRange(fy);
    const dueDate = corporationTaxDueDateForFy(fy);
    if (dueDate > todayIso && dueDate <= horizonIso) {
      result.push({
        regime: 'corporation_tax',
        periodLabel: range.label,
        dueDate,
        periodStartDate: range.startDate,
        periodEndDate: range.endDate,
      });
    }
  }

  return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
