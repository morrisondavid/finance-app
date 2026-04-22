/**
 * Corporation Tax auto-seeder.
 *
 * For every financial year the ledger covers, emit a single
 * `auto-ct-{fyEnd}` obligation dated `fyEnd + 9 months + 1 day` (UK CT
 * deadline for sub-£1.5M profit companies — the standard case, and the
 * only path this seeder models).
 *
 * Payment attribution: only `HMRC CORPORATION T…` and `HMRC GOV.UK COTAX…`
 * narratives count as CT settlements. `HMRC ETMP…` is deliberately NOT
 * treated as CT — in the user's ledger those lines are recurring PAYE-
 * style installments or Time-To-Pay arrangement debits, never direct CT.
 * Conflating them would over-attribute CT and hide the true recurring
 * installment pattern from the TTP detector.
 *
 * Proximity window: ±90 days. CT is paid around the deadline in practice,
 * but real-world data shows legitimate settlements landing up to ~80 days
 * early (batch payments from the prior quarter) or ~20 days late. Because
 * the narrative prefix (`HMRC CORPORATION T…` / `HMRC GOV.UK COTAX…`) is
 * already CT-specific, a generous window cannot over-attribute unrelated
 * HMRC debits — they wouldn't match the narrative filter in the first
 * place. The matcher is greedy one-payment-per-slot, so at worst a very
 * early payment attaches to the nearest CT slot rather than orphaning.
 */

import { getDb } from '../connection.js';
import {
  calculateCorporationTax,
  VAT,
} from '../../config/tax-rates.js';
import { HMRC_PATTERNS } from '../../domain/payees/index.js';
import { businessPaymentAccounts } from '../../domain/accounts/index.js';
import { insertAutoObligation } from './obligations.js';
import { isDismissed } from './obligation-dismissals.js';
import { findHmrcPayments, type HmrcPaymentMatch } from './tax.js';
import { matchPaymentsToSlots } from '../../utils/payment-matcher.js';
import {
  getAvailableFinancialYears,
  getFinancialYearRange,
} from '../utils/financial-year.js';
import { buildAccountInFilter } from '../utils/tax-account-filter.js';
import { corpTaxApplicableAccounts } from '../../domain/accounts/index.js';
import { round2 } from '../../utils/math.js';

/**
 * Proximity window for CT → bank payment matching. Generous (±90 days)
 * because CT-specific narrative prefixes already prevent mis-attribution —
 * a payment has to already look like CT to even be a candidate, so the
 * window only decides which CT slot a CT payment attaches to. Real-world
 * settlements land anywhere from ~80 days before the deadline (batch
 * settlement in the prior quarter) to ~20 days after (HMRC card gateway
 * posting delay), and both must attach.
 */
export const CT_MATCH_PROXIMITY_DAYS = 90;

/**
 * Manual supersede window. Mirrors the SA seeder pattern: if the user has
 * hand-entered a CT obligation within ± this many days of the computed
 * auto due date, the auto row is suppressed entirely.
 */
export const CT_MANUAL_SUPERSEDE_WINDOW_DAYS = 45;

export interface CtSlot {
  /** ISO end date of the accounting period, YYYY-MM-DD (typically April 30). */
  fyEnd: string;
  /** Human label, e.g. "2024/25". */
  fyLabel: string;
  /** ISO due date, YYYY-MM-DD (= fyEnd + 9 months + 1 day). */
  dueDate: string;
}

/**
 * Enumerate every CT slot we have transaction coverage for. Slots are
 * derived from {@link getAvailableFinancialYears} so the list expands
 * automatically as the ledger grows.
 */
export function enumerateCtSlots(): CtSlot[] {
  const fys = getAvailableFinancialYears();
  return fys.map(fyLabel => {
    const range = getFinancialYearRange(fyLabel);
    return {
      fyEnd: range.endDate,
      fyLabel: range.label,
      dueDate: computeCtDueDate(range.endDate),
    };
  });
}

/**
 * UK CT deadline for sub-£1.5M profit companies: 9 months + 1 day after
 * the accounting period ends. Uses UTC arithmetic to avoid DST edge cases.
 */
function computeCtDueDate(fyEnd: string): string {
  const [y, m, d] = fyEnd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + 9);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Ledger-scoped CT income for one FY (corp-tax-applicable accounts only).
 * Matches the same "net of VAT" treatment getTaxLiabilities() uses on the
 * dashboard so the two surfaces cannot drift.
 */
function sumCtIncomeForFy(fy: { startDate: string; endDate: string }): number {
  const db = getDb();
  // Roadmap 1.1 / Phase 4: UK CT seeder only — UAE CT auto-seeding is
  // gated on QFZP election and handled separately once the status is
  // resolved. The `corpTaxApplicable` index already excludes UAE FZCO
  // while its QFZP status is 'TBC'; no separate entity filter needed.
  const filter = buildAccountInFilter(corpTaxApplicableAccounts());
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE type = 'income' AND date >= ? AND date <= ? ${filter.clause}
  `).get(fy.startDate, fy.endDate, ...filter.params) as { total: number };
  return row.total;
}

/**
 * Mirrors the manual-supersede guard on sa-auto-seed: if the user has
 * added a manual CT obligation near the computed deadline, the auto row
 * is suppressed so the two rows cannot double-count.
 */
function hasManualSupersede(slot: CtSlot): boolean {
  const db = getDb();
  const windowStart = shiftIso(slot.dueDate, -CT_MANUAL_SUPERSEDE_WINDOW_DAYS);
  const windowEnd = shiftIso(slot.dueDate, CT_MANUAL_SUPERSEDE_WINDOW_DAYS);
  const row = db.prepare(`
    SELECT 1 AS hit FROM financial_obligations
    WHERE source = 'manual'
      AND type = 'corporation-tax'
      AND due_date IS NOT NULL
      AND due_date >= ?
      AND due_date <= ?
    LIMIT 1
  `).get(windowStart, windowEnd) as { hit: number } | undefined;
  return row !== undefined;
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pull every CT-narrative HMRC debit from the ledger. Only business
 * payment accounts — CT is a company liability, never paid from personal.
 */
function fetchCtPayments(): HmrcPaymentMatch[] {
  return findHmrcPayments({
    patterns: HMRC_PATTERNS.CORPORATION_TAX,
    accounts: [...businessPaymentAccounts()],
    startDate: '0000-01-01',
    endDate: '9999-12-31',
  });
}

/**
 * Derive and insert auto Corporation Tax obligations for every FY the
 * ledger covers. Idempotent — deletes all `source='auto' AND
 * type='corporation-tax'` rows first.
 *
 * Contract:
 * - One auto row per FY.
 * - Zero-income FYs are skipped (no liability to show).
 * - Dismissed slots (`auto-ct-{fyEnd}` in obligation_dismissals) are skipped.
 * - Matched payments populate `paid_*` and set status to `paid`.
 * - Unmatched past-due slots are `unpaid`; pre-deadline slots are `not-yet-due`.
 * - A manual CT obligation within ±{@link CT_MANUAL_SUPERSEDE_WINDOW_DAYS}
 *   of the computed deadline suppresses the auto row entirely.
 */
export function deriveAndInsertAutoCtObligations(referenceDate: Date = new Date()): void {
  const db = getDb();
  db.prepare("DELETE FROM financial_obligations WHERE source = 'auto' AND type = 'corporation-tax'").run();

  const slots = enumerateCtSlots();
  if (slots.length === 0) return;

  const payments = fetchCtPayments();
  const paymentBySlot = matchPaymentsToSlots(
    slots.map(s => ({ key: ctSlotKey(s), dueDate: s.dueDate })),
    payments,
    CT_MATCH_PROXIMITY_DAYS,
  );

  const todayStr = referenceDate.toISOString().slice(0, 10);
  let inserted = 0;

  for (const slot of slots) {
    if (hasManualSupersede(slot)) continue;

    const range = getFinancialYearRange(slot.fyLabel);
    const income = sumCtIncomeForFy(range);
    if (income <= 0) continue;

    // Mirror the dashboard's taxable-profit treatment: income minus
    // VAT-on-income. Expenses are intentionally NOT deducted (conservative
    // CT estimate — the real figure comes from the accountant later, at
    // which point the user adds a manual obligation that supersedes this).
    const incomeNetOfVat = income - round2(income * VAT.FRACTION);
    const taxableProfit = Math.max(0, incomeNetOfVat);
    const expectedAmount = round2(calculateCorporationTax(taxableProfit).tax);
    if (expectedAmount <= 0) continue;

    const id = `auto-ct-${slot.fyEnd}`;
    if (isDismissed(id)) continue;

    const match = paymentBySlot.get(ctSlotKey(slot)) ?? null;
    const dueDatePassed = slot.dueDate < todayStr;
    const status: string = match
      ? 'paid'
      : dueDatePassed
      ? 'unpaid'
      : 'not-yet-due';

    insertAutoObligation({
      id,
      type: 'corporation-tax',
      name: `Corporation Tax — FY ${slot.fyLabel}`,
      entity: 'HMRC',
      frequency: 'annual',
      expectedAmount,
      dueDate: slot.dueDate,
      status,
      paidAmount: match ? round2(Math.abs(match.amount)) : null,
      paidDate: match?.date ?? null,
      paidFromAccount: match?.account ?? null,
      notes: `Estimate based on FY ${slot.fyLabel} income, net of VAT. Corrected automatically once HMRC settles.`,
    });
    inserted++;
  }

  if (inserted > 0) {
    console.log(`[Database] Derived ${inserted} auto Corporation Tax obligation(s)`);
  }
}

/** Stable matcher key for a CT slot. */
function ctSlotKey(slot: CtSlot): string {
  return `ct-${slot.fyEnd}`;
}
