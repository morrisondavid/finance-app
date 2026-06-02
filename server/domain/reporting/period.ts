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

export function resolveReportingPeriod(
  regime: ReportingRegime,
  periodLabel: string,
): ReportingPeriod {
  const trimmed = periodLabel.trim();
  if (regime === 'vat') {
    return resolveVatPeriod(trimmed);
  }
  return resolveCtPeriod(trimmed);
}
