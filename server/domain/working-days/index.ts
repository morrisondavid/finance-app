/**
 * Working-days primitives — pure helpers for iterating over the
 * calendar days a contract actually works (mask ∩ range minus
 * excluded dates), plus entity-scoped public-holiday lookups via
 * `date-holidays`.
 *
 * This module is deliberately NOT a canonical registry — it has no
 * set-wise config to index — so it is exempt from the manifest sweep
 * via `server/domain/_shared/all-registries.manifest.test.ts`'s
 * `NON_REGISTRY_DIRS` list.
 */

export { contractWeekdayMask, jsDayToMondayIndex, type WeekdayMask } from './weekday-mask.js';
export { iterateWorkingDays, type IterateWorkingDaysInput } from './iterate.js';
export { countWorkingDays } from './count.js';

export {
  getPublicHolidays,
  holidayDatesForEntity,
  __resetPublicHolidayCacheForTests,
  type PublicHoliday,
} from './public-holidays.js';
