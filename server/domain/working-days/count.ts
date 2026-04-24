/**
 * Pure helper: count the working days in a range. Thin wrapper over
 * {@link iterateWorkingDays} — kept as a named export so callers that
 * only need the count don't have to materialise or iterate the list
 * themselves. The parity test `count.test.ts` guards against the
 * wrapper drifting from the iterator.
 */

import { iterateWorkingDays, type IterateWorkingDaysInput } from './iterate.js';

export function countWorkingDays(input: IterateWorkingDaysInput): number {
  let n = 0;
  for (const _day of iterateWorkingDays(input)) n += 1;
  return n;
}
