import { getDb } from '../connection.js';

/**
 * Company Accounting Period: March 1 to end of February
 * 
 * Accounting year "2024/25" means: March 1, 2024 to February 28, 2025
 * Leap years (e.g., 2023/24) end on February 29
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
  
  // Handle leap year for February end date
  const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const febLastDay = isLeapYear(endYear) ? 29 : 28;
  
  return {
    startDate: `${startYear}-03-01`,
    endDate: `${endYear}-02-${febLastDay}`,
    label: `${startYear}/${String(endYear).slice(-2)}`
  };
}

/**
 * Build SQL WHERE clause for financial year filtering
 */
export function buildFYWhereClause(fy: string | undefined): { clause: string; params: string[] } {
  if (!fy) {
    return { clause: '', params: [] };
  }
  
  const range = getFinancialYearRange(fy);
  return {
    clause: ' AND date >= ? AND date <= ?',
    params: [range.startDate, range.endDate]
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
  // Company accounting year starts March 1, so if date is before March, it's in the previous accounting year
  const getFinancialYear = (date: Date): number => {
    const month = date.getMonth(); // 0-11
    const year = date.getFullYear();
    // If before March (months 0-1), it's the previous year's accounting period
    return month < 2 ? year - 1 : year;
  };
  
  const startFY = getFinancialYear(minDate);
  const endFY = getFinancialYear(maxDate);
  
  const years: string[] = [];
  for (let fy = endFY; fy >= startFY; fy--) {
    years.push(`${fy}/${String(fy + 1).slice(-2)}`);
  }
  
  return years;
}
