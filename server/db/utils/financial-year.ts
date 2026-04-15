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
