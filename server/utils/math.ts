/** Round to 2 decimal places (banker-safe). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Median of a numeric list (0 for empty). Does not mutate the input. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Extract YYYY-MM from an ISO date string (e.g. "2025-06-15" → "2025-06"). */
export function monthKeyFromIsoDate(dateStr: string): string {
  return dateStr.slice(0, 7);
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
