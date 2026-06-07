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
 * Move a calendar `YYYY-MM-DD` by `deltaMonths` months. Day-of-month is
 * clamped to the target month's length (e.g. 31 Jan + 1 mo → 28 Feb).
 */
export function isoDateAddCalendarMonths(iso: string, deltaMonths: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const startMonthIndex = m - 1 + deltaMonths;
  const targetYear = y + Math.floor(startMonthIndex / 12);
  const targetMonth = ((startMonthIndex % 12) + 12) % 12;
  const dim = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(d, dim);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

/** UK company tax / HMRC obligations use the Europe/London calendar day. */
export const UK_BUSINESS_TIMEZONE = 'Europe/London';

/**
 * Calendar `YYYY-MM-DD` for `now` in an IANA timezone (default UK business).
 * Use for obligation due-date bucketing so server (often UTC) and UI agree.
 */
export function todayIsoInTimeZone(
  now: Date = new Date(),
  timeZone: string = UK_BUSINESS_TIMEZONE,
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Whole days from `today` in `timeZone` to `dateStr`. Negative when overdue
 * on that calendar (same semantics as {@link daysUntil}).
 */
export function daysUntilInTimeZone(
  dateStr: string,
  timeZone: string = UK_BUSINESS_TIMEZONE,
  now: Date = new Date(),
): number {
  return daysBetween(dateStr, todayIsoInTimeZone(now, timeZone));
}

/**
 * Inclusive ISO date bounds for a calendar month (`month` is 1–12).
 */
export function calendarMonthIsoRange(
  year: number,
  month: number,
): { startDate: string; endDate: string } {
  const monthPadded = String(month).padStart(2, '0');
  const startDate = `${year}-${monthPadded}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${monthPadded}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

/**
 * Inclusive Monday..Sunday range containing the given ISO date. Uses ISO
 * 8601 week semantics (week starts Monday). Both endpoints are returned
 * as ISO `YYYY-MM-DD` strings.
 *
 * Example: `isoWeekRange('2026-01-01')` (a Thursday) returns
 * `{ start: '2025-12-29', end: '2026-01-04' }`.
 */
export function isoWeekRange(iso: string): { start: string; end: string } {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // getUTCDay: 0=Sun..6=Sat. ISO weeks start on Monday, so shift to Mon=0.
  const daysSinceMonday = (dt.getUTCDay() + 6) % 7;
  const start = shiftIsoDate(iso, -daysSinceMonday);
  const end = shiftIsoDate(start, 6);
  return { start, end };
}

/**
 * Inclusive first..last range of the calendar month containing the given
 * ISO date. Handles leap years and variable month lengths.
 *
 * Example: `monthRange('2024-02-15')` returns
 * `{ start: '2024-02-01', end: '2024-02-29' }`.
 */
export function monthRange(iso: string): { start: string; end: string } {
  const [y, m] = iso.split('-').map(Number);
  const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
  // Day 0 of the next month == last day of this month (pure UTC arithmetic).
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

/**
 * Billing month **`YYYY-MM`** for the **last complete calendar month** before **local today**
 * (May 2026 → `2026-04`; Jan 2026 → `2025-12`).
 */
export function previousCompleteBillingMonthYYYYMM(isoCalendarToday: string): string {
  const firstOfThisMonth = monthRange(isoCalendarToday).start;
  const lastDayPriorMonth = shiftIsoDate(firstOfThisMonth, -1);
  return lastDayPriorMonth.slice(0, 7);
}

/**
 * Parse a `DD/MM/YYYY` string into an ISO `YYYY-MM-DD` date.
 *
 * Complements `toIsoDate` / `shiftIsoDate` / `monthRange` — used by
 * PDF parsers (e.g. the La Fosse self-bill parser) and any other
 * ingestion path that has to normalise human-formatted UK dates onto
 * the canonical ISO surface used everywhere else in the app.
 *
 * Returns `null` for any input that isn't exactly three slash-separated
 * integer parts forming a real calendar date. Deliberately strict: we
 * would rather emit a structured parse error upstream than silently
 * accept garbage and land a wrong `period_start`.
 */
export function parseIsoFromDDMMYYYY(s: string): string | null {
  const trimmed = s.trim();
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (match === null) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return null;
  }
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Round-trip through Date to reject impossible days (e.g. 31/02/2026).
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year
    || dt.getUTCMonth() !== month - 1
    || dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
