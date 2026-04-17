import { getDb } from '../connection.js';

/**
 * Company Accounting Period: May 1 to end of April
 * 
 * Accounting year "2024/25" means: May 1, 2024 to April 30, 2025
 * Corporation tax is due 9 months + 1 day after the accounting period ends
 * (e.g. period ending 30 Apr → due 31 Jan the following calendar year).
 */
export interface FinancialYearRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  label: string;     // e.g., "2024/25"
}

/**
 * Dashboard filter options
 */
export interface DashboardFilters {
  account?: string;
  financialYear?: string;
}

/** Canonical form: "2024/25" (slash-separated). Accepts "2024-25" or "2024/25". */
export function normalizeFinancialYear(fy: string): string {
  return fy.replace('-', '/');
}

/**
 * Get the date range for a financial year
 * @param fy Financial year in format "2024/25" or "2024-25"
 */
export function getFinancialYearRange(fy: string): FinancialYearRange {
  // Extract start year from "2024/25" or "2024-25"
  const match = fy.match(/^(\d{4})[/-](\d{2})$/);
  if (!match) {
    throw new Error(`Invalid financial year format: ${fy}`);
  }
  
  const startYear = parseInt(match[1], 10);
  const endYear = startYear + 1;
  
  return {
    startDate: `${startYear}-05-01`,
    endDate: `${endYear}-04-30`,
    label: `${startYear}/${String(endYear).slice(-2)}`
  };
}

/**
 * Ordered calendar month keys (YYYY-MM) from FY start through FY end inclusive (12 months: May–April).
 */
export function listMonthKeysInFinancialYear(fy: string): string[] {
  const range = getFinancialYearRange(fy);
  const keys: string[] = [];
  const startParts = range.startDate.split('-').map(Number);
  let y = startParts[0];
  let m = startParts[1];
  for (let i = 0; i < 12; i++) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

/** Local calendar date YYYY-MM-DD (matches getFinancialYear-style month logic). */
export function formatCalendarDateLocal(d: Date): string {
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Local calendar month key YYYY-MM. */
export function calendarMonthKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/**
 * Month keys (YYYY-MM) to show for budget vs actual for the selected FY as of `asOf`:
 * - FY fully ended before `asOf`: all 12 FY months.
 * - FY contains `asOf`: from FY start through min(current calendar month, FY’s last month).
 * - FY not yet started on `asOf`: empty.
 */
export function listFyMonthKeysThroughDate(fy: string, asOf: Date): string[] {
  const all = listMonthKeysInFinancialYear(fy);
  const range = getFinancialYearRange(fy);
  const asYmd = formatCalendarDateLocal(asOf);
  if (asYmd > range.endDate) {
    return all;
  }
  if (asYmd < range.startDate) {
    return [];
  }
  const endKey = range.endDate.slice(0, 7);
  const nowKey = calendarMonthKeyFromDate(asOf);
  const cap = nowKey < endKey ? nowKey : endKey;
  return all.filter(k => k <= cap);
}

/**
 * Display label for a YYYY-MM key inside a financial year (e.g. "May 2025").
 */
export function formatFinancialYearMonthLabel(monthKey: string): string {
  const parts = monthKey.split('-');
  if (parts.length !== 2) return monthKey;
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return monthKey;
  const d = new Date(y, mo - 1, 1);
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/**
 * Returns the FY label for a given date based on the company accounting period (May–April).
 * e.g. 2025-03-15 → "2024/25", 2025-06-01 → "2025/26"
 */
export function getFinancialYearForDate(date: Date = new Date()): string {
  const month = date.getMonth(); // 0-11
  const year = date.getFullYear();
  const startYear = month < 4 ? year - 1 : year;
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

/**
 * Returns the start date of the previous financial year relative to `date`.
 * Used as the data-coverage cutoff: quarters ending before this are treated
 * as having insufficient transaction data.
 */
export function getPreviousFyStartDate(date: Date = new Date()): string {
  const currentFyLabel = getFinancialYearForDate(date);
  const currentStartYear = parseInt(currentFyLabel.slice(0, 4), 10);
  const prevStartYear = currentStartYear - 1;
  return `${prevStartYear}-05-01`;
}

/**
 * Build SQL WHERE clause for financial year filtering
 */
export function buildFYWhereClause(fy: string | undefined): { clause: string; params: string[] } {
  return buildFyWhereClauseForColumn(fy, 'date');
}

/**
 * Build SQL WHERE clause for financial year filtering on an arbitrary column name.
 * Use this when the FY range should apply to a column other than `date` (e.g. `due_date`).
 */
export function buildFyWhereClauseForColumn(
  fy: string | undefined,
  column: string,
): { clause: string; params: string[] } {
  if (!fy) {
    return { clause: '', params: [] };
  }
  const range = getFinancialYearRange(fy);
  return {
    clause: ` AND ${column} >= ? AND ${column} <= ?`,
    params: [range.startDate, range.endDate],
  };
}

/**
 * Build SQL WHERE clauses for dashboard queries
 */
export function buildDashboardFilters(filters: DashboardFilters): { clause: string; params: string[] } {
  let clause = '';
  const params: string[] = [];
  
  if (filters.account) {
    clause += ' AND account = ?';
    params.push(filters.account);
  }
  
  if (filters.financialYear) {
    const range = getFinancialYearRange(filters.financialYear);
    clause += ' AND date >= ? AND date <= ?';
    params.push(range.startDate, range.endDate);
  }
  
  return { clause, params };
}

/**
 * Get list of available financial years from transaction data
 */
export function getAvailableFinancialYears(): string[] {
  const db = getDb();
  
  // Get min and max dates from transactions
  const result = db.prepare(`
    SELECT MIN(date) as minDate, MAX(date) as maxDate FROM transactions
  `).get() as { minDate: string | null; maxDate: string | null };
  
  if (!result.minDate || !result.maxDate) {
    return [];
  }
  
  const minDate = new Date(result.minDate);
  const maxDate = new Date(result.maxDate);
  
  // Determine the financial years that span the data
  // Company accounting year starts May 1, so if date is before May, it's in the previous accounting year
  const getFinancialYear = (date: Date): number => {
    const month = date.getMonth(); // 0-11
    const year = date.getFullYear();
    // If before May (months 0-3), it's the previous year's accounting period
    return month < 4 ? year - 1 : year;
  };
  
  const startFY = getFinancialYear(minDate);
  const endFY = getFinancialYear(maxDate);
  
  const years: string[] = [];
  for (let fy = endFY; fy >= startFY; fy--) {
    years.push(`${fy}/${String(fy + 1).slice(-2)}`);
  }
  
  return years;
}
