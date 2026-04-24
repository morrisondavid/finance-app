/**
 * Pure helper: project a Contract's `works_*` booleans onto a
 * Monday-indexed 7-tuple suitable for day-of-week lookups during
 * working-days iteration.
 *
 * Index convention: `0 = Monday, ..., 6 = Sunday`. This matches ISO
 * 8601 week numbering and lets callers use `(jsGetDay() + 6) % 7` to
 * index into the mask from a JS Date's `getUTCDay()` (which is
 * `0 = Sunday, ..., 6 = Saturday`).
 */

import type { Contract } from '../../../shared/api-contracts.js';

export type WeekdayMask = readonly [boolean, boolean, boolean, boolean, boolean, boolean, boolean];

export function contractWeekdayMask(contract: Pick<Contract,
  'works_monday' | 'works_tuesday' | 'works_wednesday' | 'works_thursday' |
  'works_friday' | 'works_saturday' | 'works_sunday'
>): WeekdayMask {
  return [
    contract.works_monday,
    contract.works_tuesday,
    contract.works_wednesday,
    contract.works_thursday,
    contract.works_friday,
    contract.works_saturday,
    contract.works_sunday,
  ] as const;
}

/**
 * Map a JS `Date.getUTCDay()` return value (0=Sun..6=Sat) to the
 * Mon-indexed position in a {@link WeekdayMask}.
 */
export function jsDayToMondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}
