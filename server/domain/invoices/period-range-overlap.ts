/**
 * Pure closed-interval overlap for ISO date ranges (inclusive start/end).
 */

export function isoPeriodRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return !(aEnd < bStart || aStart > bEnd);
}
