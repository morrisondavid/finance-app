/**
 * Shared urgency status + bucketing for anything with a due date.
 *
 * Obligations overdue hero, deadlines list view, deadlines feed endpoint,
 * and the ICS builder all need to answer the same two questions for an
 * item with a `dueDate` (and optional "completed" flag):
 *
 *   1. What is its urgency right now? (status)
 *   2. Which visual group should it render in? (bucket)
 *
 * Implementing these in one place guarantees every consumer agrees on
 * the thresholds and means changing a bucket boundary (e.g. tightening
 * "due soon" from 7 to 5 days) requires exactly one edit — and its tests
 * automatically fail across every consumer.
 *
 * Thresholds are deliberately simple and calendar-based:
 *   - overdue:    dueDate <  todayIso
 *   - due-soon:   dueDate ∈ [todayIso, todayIso + 7d]  (excluding overdue)
 *   - upcoming:   dueDate >  todayIso + 7d
 *   - completed:  any dueDate, `completed === true`
 *
 * Bucket groupings match the UI headers the user sees:
 *   - overdue
 *   - this-week  = status === 'due-soon'
 *   - this-month = within current calendar month, not in this-week
 *   - this-year  = within current calendar year, not in this-month
 *   - later      = further than end of year
 *   - completed  = completed
 */

import { daysBetween, todayIsoLocal } from './iso-date.js';

export type UrgencyStatus = 'overdue' | 'due-soon' | 'upcoming' | 'completed';
export type UrgencyBucket =
  | 'overdue'
  | 'this-week'
  | 'this-month'
  | 'this-year'
  | 'later'
  | 'completed';

/**
 * Minimal shape a consumer must project into for
 * {@link bucketItemsByUrgency}. The same object can carry arbitrary
 * extra fields — bucketing only reads `dueDate` and `completed`.
 */
export interface UrgencyItem {
  dueDate: string;
  completed: boolean;
}

/** Days-from-today inside which an item is "due soon". */
export const DUE_SOON_WINDOW_DAYS = 7;

/**
 * Derive the urgency status for an item. `completed` short-circuits
 * every other branch — a completed item is always reported as
 * `completed` regardless of its due date.
 */
export function deriveUrgencyStatus(
  dueDate: string,
  today: Date,
  completed: boolean,
): UrgencyStatus {
  if (completed) return 'completed';
  const todayIso = todayIsoLocal(today);
  const diff = daysBetween(dueDate, todayIso);
  if (diff < 0) return 'overdue';
  if (diff <= DUE_SOON_WINDOW_DAYS) return 'due-soon';
  return 'upcoming';
}

/**
 * Derive the presentation bucket for an item. Distinct from
 * {@link deriveUrgencyStatus} because buckets are calendar-aware
 * (this-month / this-year / later) whereas status is window-based.
 */
export function urgencyBucket(
  dueDate: string,
  today: Date,
  completed: boolean,
): UrgencyBucket {
  if (completed) return 'completed';
  const status = deriveUrgencyStatus(dueDate, today, completed);
  if (status === 'overdue') return 'overdue';
  if (status === 'due-soon') return 'this-week';

  const [dyStr, dmStr] = dueDate.split('-');
  const dy = Number(dyStr);
  const dm = Number(dmStr);
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;

  if (dy === ty && dm === tm) return 'this-month';
  if (dy === ty) return 'this-year';
  return 'later';
}

/**
 * Group a list of urgency-bearing items by presentation bucket. Every
 * bucket is always present in the returned record (empty array when no
 * items qualify) so UI callers can iterate a fixed set of headers
 * without null-checks.
 */
export function bucketItemsByUrgency<T extends UrgencyItem>(
  items: readonly T[],
  today: Date,
): Record<UrgencyBucket, T[]> {
  const groups: Record<UrgencyBucket, T[]> = {
    overdue: [],
    'this-week': [],
    'this-month': [],
    'this-year': [],
    later: [],
    completed: [],
  };
  for (const item of items) {
    const bucket = urgencyBucket(item.dueDate, today, item.completed);
    groups[bucket].push(item);
  }
  return groups;
}
