/**
 * UK Self Assessment tax year boundaries (6 Apr → 5 Apr).
 * Shared by the SA estimator and residency queries to avoid circular imports.
 */

/** Tax year start year for a date (e.g. 2026-03-07 → 2025; 2026-04-06 → 2026). */
export function getSaTaxYearForDate(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  if (month < 3 || (month === 3 && day < 6)) {
    return year - 1;
  }
  return year;
}

/** ISO boundaries for a UK tax year given its start year. */
export function getSaTaxYearRange(startYear: number): { start: string; end: string } {
  const start = `${startYear}-04-06`;
  const end = `${startYear + 1}-04-05`;
  return { start, end };
}
