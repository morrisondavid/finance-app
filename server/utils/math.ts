/** Round to 2 decimal places (banker-safe). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Rolling window for budget / recurring analysis (months). */
export const ROLLING_MONTHS = 24;

/** Tolerance when comparing recurring amounts to a “typical” figure (variance highlights). */
export const VARIANCE_EPS = 0.005;
