/**
 * Shared helpers for UK financial years (1 May – 30 Apr).
 * Labels use the `YYYY/YY` format, e.g. `2025/26`.
 */

/** Return the FY label (`YYYY/YY`) that contains the given date. */
export function getCurrentFinancialYearLabel(date: Date = new Date()): string {
  const month = date.getMonth(); // 0-11
  const year = date.getFullYear();
  const startYear = month < 4 ? year - 1 : year;
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

/**
 * Shift an FY label by `delta` years.
 * `shiftFinancialYear('2025/26', 1)` → `'2026/27'`
 * `shiftFinancialYear('2025/26', -1)` → `'2024/25'`
 */
export function shiftFinancialYear(label: string, delta: number): string {
  const match = /^(\d{4})\/(\d{2})$/.exec(label);
  if (!match) throw new Error(`Invalid financial year label: ${label}`);
  const startYear = Number(match[1]);
  const shifted = startYear + delta;
  return `${shifted}/${String(shifted + 1).slice(-2)}`;
}
