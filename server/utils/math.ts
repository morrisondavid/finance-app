/** Round to 2 decimal places (banker-safe). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Rolling window for expenses / recurring analysis (months). */
export const ROLLING_MONTHS = 24;

/** Tolerance when comparing recurring amounts to a “typical” figure (variance highlights). */
export const VARIANCE_EPS = 0.005;

/** ISO date string for the first day of the window `months` ago from today (local). */
export function rollingCutoffIsoDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
