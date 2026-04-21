/**
 * Unified deadline feed.
 *
 * Merges non-financial deadlines (deadlines CSV) with financial
 * obligations (obligations DB) into a single `DeadlineFeedItem[]`
 * stream the frontend calendar + list view and the ICS exporter both
 * consume. Keeping a single pure builder guarantees the list view, the
 * calendar pill, and the subscribed Google Calendar feed all agree on
 * what's overdue, what's due-soon, and what the display label should
 * read — if they didn't, the user would rightly lose trust in the data.
 *
 * This module is intentionally *pure*: it reads via the two injected
 * data loaders so tests can drive it deterministically without touching
 * disk or the real SQLite connection. The default loaders used in
 * production wire up the real repositories.
 */

import {
  type Deadline,
  type DeadlineFeedItem,
  type DeadlineFeedSource,
  type ObligationRow,
  type UrgencyStatus,
  DeadlineFeedItemSchema,
} from '../../../shared/api-contracts.js';
import { deriveUrgencyStatus } from '../../../shared/urgency.js';
import { getAllDeadlines } from './deadlines.js';
import { getAllObligations, toApiObligation, COMPLETED_STATUSES } from './obligations.js';

const COMPLETED_STATUS_SET: ReadonlySet<string> = new Set(COMPLETED_STATUSES);

export interface BuildDeadlineFeedOptions {
  /** "Now" anchor for urgency derivation. Defaults to `new Date()`. */
  today?: Date;
  /**
   * Optional window filter — items with `dueDate < from` or
   * `dueDate > to` are excluded. ISO dates (`YYYY-MM-DD`) inclusive on
   * both ends. Omit to include everything. Used by the ICS builder to
   * avoid publishing years of stale history.
   */
  from?: string | null;
  to?: string | null;
  /** When `true`, items whose `completed === true` are dropped. */
  excludeCompleted?: boolean;
  /** Data loaders — injected for testability. */
  loaders?: {
    loadDeadlines?: () => Deadline[];
    loadObligationRows?: () => ObligationRow[];
  };
}

/**
 * Shape we use internally before Zod-validating to `DeadlineFeedItem`.
 * Separated so the intermediate projection is typed — no `any`.
 */
interface DeadlineFeedCandidate {
  id: string;
  source: DeadlineFeedSource;
  title: string;
  dueDate: string;
  type: string;
  status: UrgencyStatus;
  amount: number | null;
  entity: string | null;
  notes: string | null;
  url: string | null;
  updatedAt: string;
  completed: boolean;
}

function defaultLoadDeadlines(): Deadline[] {
  return getAllDeadlines();
}

function defaultLoadObligationRows(): ObligationRow[] {
  return getAllObligations().map(toApiObligation);
}

/**
 * Feed-stable id for an obligation. Prefixed so it never collides with
 * a deadline id (which always begins with `dl-`). The prefix also makes
 * client-side routing trivial: split on `:` and branch.
 */
function obligationFeedId(obligationId: string): string {
  return `obligation:${obligationId}`;
}

/** Feed-stable id for a deadline. Mirror of {@link obligationFeedId}. */
function deadlineFeedId(deadlineId: string): string {
  return `deadline:${deadlineId}`;
}

function deadlineToCandidate(d: Deadline, today: Date): DeadlineFeedCandidate {
  const completed = d.completedDate !== null;
  return {
    id: deadlineFeedId(d.id),
    source: 'deadline',
    title: d.title,
    dueDate: d.dueDate,
    type: d.type,
    status: deriveUrgencyStatus(d.dueDate, today, completed),
    amount: null,
    entity: null,
    notes: d.notes,
    url: d.url,
    updatedAt: d.updatedAt,
    completed,
  };
}

function obligationToCandidate(o: ObligationRow, today: Date): DeadlineFeedCandidate | null {
  if (o.dueDate === null) return null;
  const completed = COMPLETED_STATUS_SET.has(o.status);
  return {
    id: obligationFeedId(o.id),
    source: 'obligation',
    title: o.name,
    dueDate: o.dueDate,
    type: o.type,
    status: deriveUrgencyStatus(o.dueDate, today, completed),
    amount: o.expectedAmount,
    entity: o.entity,
    notes: o.notes,
    url: null,
    updatedAt: o.updatedAt ?? o.createdAt ?? new Date().toISOString(),
    completed,
  };
}

function inWindow(
  iso: string,
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

/**
 * Build the unified feed. Output is sorted by `dueDate` ascending, then
 * by `id` for deterministic tiebreaking — the ICS builder depends on
 * this ordering to produce diff-stable exports.
 */
export function buildDeadlineFeed(options: BuildDeadlineFeedOptions = {}): DeadlineFeedItem[] {
  const today = options.today ?? new Date();
  const loadDeadlines = options.loaders?.loadDeadlines ?? defaultLoadDeadlines;
  const loadObligationRows = options.loaders?.loadObligationRows ?? defaultLoadObligationRows;

  const deadlines = loadDeadlines();
  const obligations = loadObligationRows();

  const candidates: DeadlineFeedCandidate[] = [];

  for (const d of deadlines) {
    if (!inWindow(d.dueDate, options.from, options.to)) continue;
    const candidate = deadlineToCandidate(d, today);
    if (options.excludeCompleted && candidate.completed) continue;
    candidates.push(candidate);
  }

  for (const o of obligations) {
    const candidate = obligationToCandidate(o, today);
    if (!candidate) continue;
    if (!inWindow(candidate.dueDate, options.from, options.to)) continue;
    if (options.excludeCompleted && candidate.completed) continue;
    candidates.push(candidate);
  }

  candidates.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return a.id.localeCompare(b.id);
  });

  return candidates.map(c => DeadlineFeedItemSchema.parse(c));
}
