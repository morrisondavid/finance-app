/**
 * Shared ISO date helpers — one source of truth for "what day is it"
 * across the server and the frontend.
 *
 * All helpers are pure and accept an injected `today`/`now` so tests can
 * pin time without touching the global Date constructor. The ISO format
 * everywhere in the app is `YYYY-MM-DD` (all-day, no timezone suffix).
 *
 * Two distinct concepts are deliberately kept apart:
 *   - {@link toIsoDate} converts a Date to an ISO date using UTC, which is
 *     the correct choice whenever the Date was itself constructed in UTC
 *     (e.g. by {@link shiftIsoDate}).
 *   - {@link todayIsoLocal} returns the user's local calendar day, which
 *     is what the UI means by "today" on a UK-configured machine. Using
 *     UTC for that would roll over to the next day after 00:00 UTC.
 */

/** Convert a Date to `YYYY-MM-DD` using its UTC components. */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Shift an ISO date string (`YYYY-MM-DD`) by an integer number of days.
 * Uses UTC midpoint to avoid DST edge cases.
 */
export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Signed day distance `a - b` for two ISO dates (`YYYY-MM-DD`).
 * Positive when `a` is after `b`. Uses UTC so DST transitions don't
 * create off-by-one results.
 */
export function daysBetween(a: string, b: string): number {
  const toUtc = (iso: string): number => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000);
}

/**
 * Whole days from `today` to `dateStr`. Negative when the date is in
 * the past. `today` defaults to the current local calendar day so
 * callers in UI code get the obvious "days until" semantics.
 */
export function daysUntil(dateStr: string, today: Date = new Date()): number {
  return daysBetween(dateStr, todayIsoLocal(today));
}

/** Human-friendly label for a `daysUntil` result ("Today", "3 days", "2 days overdue"). */
export function daysLabel(days: number): string {
  if (days < 0) {
    const n = Math.abs(days);
    return `${n} ${n === 1 ? 'day' : 'days'} overdue`;
  }
  if (days === 0) return 'Today';
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Current date as an ISO `YYYY-MM-DD` string in local time — the user's
 * "today" on the machine running this app, not UTC. `now` defaults to
 * `new Date()` so callers only need to pass it in tests.
 */
export function todayIsoLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
