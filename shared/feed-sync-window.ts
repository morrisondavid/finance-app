/**
 * Pure helper for §3.4 feed sync UI: derive `dateFrom` for
 * `POST /api/feed/sync` from dashboard per-account summary.
 */
import { shiftIsoDate } from './iso-date.js';

/** When no transactions exist, start wide; `resolveWindow` still narrows. */
export const FEED_SYNC_FALLBACK_DATE_FROM = '2018-01-01';

/**
 * Returns the calendar day **after** `newestTransaction` (`YYYY-MM-DD`),
 * or {@link FEED_SYNC_FALLBACK_DATE_FROM} when missing / invalid.
 */
export function computeFeedSyncDateFromNewestTransaction(
  newestTransaction: string | null,
): string {
  if (newestTransaction === null || newestTransaction.trim() === '') {
    return FEED_SYNC_FALLBACK_DATE_FROM;
  }
  const iso = newestTransaction.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return FEED_SYNC_FALLBACK_DATE_FROM;
  }
  return shiftIsoDate(iso, 1);
}
