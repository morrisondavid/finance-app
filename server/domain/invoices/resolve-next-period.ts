/**
 * Resolve the start date of the next invoice period for a contract.
 *
 * This is the heart of the §1.3 invoice draft endpoint's "two-click"
 * UX: given a contract and every invoice already on record for it,
 * figure out where the next billable period begins so the UI can
 * pre-populate the form without asking the user.
 *
 * The §1.3 plan defines a four-step fallback chain; Phase 1 ships
 * steps 1 and 4 only:
 *
 *   1. Latest invoice with `status !== 'draft'` →
 *      `period_end + 1 day`. (Step 2 — matched payments — and step 3
 *      — narrative fallback — arrive in Phase 4. Phase 1's Contracts
 *      tab already has narrative matching via
 *      `resolveAccrualWindowStart`, unchanged by this module.)
 *
 *   4. Calendar month start containing `today`, clamped to
 *      `contract.start_date`. This is the fallback when the contract
 *      has never been invoiced (new engagements, FZCO before its
 *      first self-bill lands).
 *
 * Result is always clamped to `contract.start_date` — we can never
 * back-date an invoice before the contract begins.
 *
 * Pure function; no registry access, no I/O.
 */

import type { Contract } from '../../../shared/api-contracts.js';
import { monthRange, shiftIsoDate } from '../../../shared/iso-date.js';
import type { Invoice } from './schema.js';

export interface ResolveNextPeriodInput {
  readonly contract: Contract;
  /**
   * Invoices pre-filtered to this contract. Order is not significant
   * — the function scans for the latest non-draft row itself.
   */
  readonly invoices: readonly Invoice[];
  readonly today: string;
}

/** Return the greater of two ISO dates. */
function max(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * Pick the latest non-draft invoice by `invoice_date` (ties broken by
 * `id` for determinism). Returns null when no non-draft invoice
 * exists for this contract.
 */
function latestNonDraft(invoices: readonly Invoice[]): Invoice | null {
  let best: Invoice | null = null;
  for (const inv of invoices) {
    if (inv.status === 'draft') continue;
    if (best === null) { best = inv; continue; }
    if (inv.invoice_date > best.invoice_date) { best = inv; continue; }
    if (inv.invoice_date === best.invoice_date && inv.id > best.id) { best = inv; }
  }
  return best;
}

export function resolveNextPeriodStart(input: ResolveNextPeriodInput): string {
  const { contract, invoices, today } = input;

  // Step 1 — latest non-draft invoice's period_end + 1 day.
  const latest = latestNonDraft(invoices);
  if (latest !== null) {
    return max(shiftIsoDate(latest.period_end, 1), contract.start_date);
  }

  // Step 4 — calendar month start, clamped to contract start.
  const { start } = monthRange(today);
  return max(start, contract.start_date);
}
