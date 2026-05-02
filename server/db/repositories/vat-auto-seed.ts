import { getDb } from '../connection.js';
import { VAT, getVatQuarterForDate, type VatQuarterRange } from '../../config/tax-rates.js';
import { HMRC_PATTERNS } from '../../domain/payees/index.js';
import { businessPaymentAccounts, vatApplicableAccounts } from '../../domain/accounts/index.js';
import { findHmrcPayments, type HmrcPaymentMatch } from './tax.js';
import { insertAutoObligation } from './obligations.js';
import { isDismissed } from './obligation-dismissals.js';
import { reconcileVatQuarter, type VatQuarterReconciliation } from '../../utils/vat-reconciliation.js';
import { getPreviousFyStartDate } from '../utils/financial-year.js';
import { buildAccountInFilter, type AccountFilterResult } from '../utils/tax-account-filter.js';
import {
  matchPaymentsToSlots,
  shiftIsoDate,
  DEFAULT_MAX_PROXIMITY_DAYS,
} from '../../utils/payment-matcher.js';

/**
 * Stable key for a VAT quarter. Kept local to the seeder so the matcher
 * stays domain-agnostic.
 */
function vatQuarterKey(q: VatQuarterRange): string {
  return `${q.startDate}-${q.endDate}`;
}

/**
 * First VAT-applicable bank activity falls in the **closing calendar month**
 * of a quarter whose official start predates that activity (e.g. first income
 * on 2022-04-19 in Feb–Apr 2022). Seeding a normal obligation for that stub
 * quarter over-counts pre-ledger weeks; we treat it as `insufficient-data`
 * instead of surfacing a misleading row.
 *
 * Conversely, first income in **June** for May–Jul (quarter ends July) must
 * still seed: activity month (June) ≠ closing month (July), so we do not
 * demote — this matches card-channel VAT tests and real mid-quarter onboards.
 */
function isPartialFirstQuarterBeforeLedger(
  q: VatQuarterRange,
  earliestTxDate: string,
  hasPaymentMatch: boolean,
): boolean {
  if (hasPaymentMatch) return false;
  if (q.startDate >= earliestTxDate) return false;
  return earliestTxDate.slice(0, 7) === q.endDate.slice(0, 7);
}

/**
 * Row in a VAT reconciliation set. Pairs a quarter with its reconciled payment
 * state and the income total we derived from the ledger (handy for display).
 */
export interface VatReconciliationRow {
  quarter: VatQuarterRange;
  income: number;
  reconciliation: VatQuarterReconciliation;
}

/**
 * Build the canonical set of VAT quarters + reconciliations that both the
 * auto-seeder and the /vat-reconciliation API endpoint consume.
 *
 * Centralising this guarantees the two paths cannot drift: the list of
 * quarters the user sees on the Obligations page is exactly the list the
 * auto-seeder writes to `financial_obligations`.
 *
 * Quarter enumeration starts at `min(earliestTxDate, firstVatPaymentDate -
 * maxProximity)` so the matcher always has enough canvas to attribute
 * pre-data payments to their real quarter, but quarters that end up
 * unmatched AND due before the first observed VAT payment are treated as
 * implicitly covered (HMRC would have chased the user otherwise) and
 * demoted to `insufficient-data` so they do not surface as overdue rows.
 *
 * **`dataCutoff` is null when there is no VAT-settlement payment in the
 * ledger** (`HMRC VAT%` or `HMRC ETMP% Card Ending%`). Bare `HMRC ETMP`
 * lines are TTP / payment-plan debits, not VAT — they must not advance
 * `firstVatPaymentDate` and must not force a FY-based cutoff that strips
 * real quarters from the obligations table.
 */
export function buildVatReconciliationSet(
  referenceDate: Date = new Date(),
): VatReconciliationRow[] {
  // VAT seeder is scoped by the registry's `vatApplicable` index:
  // the only gate is `vat.applicable && vat.registered`. A future
  // VAT-registered FZCO account would be added to the index by
  // flipping its flag, not by a separate entity filter here.
  const vatFilter = buildAccountInFilter(vatApplicableAccounts());

  const earliestTxDate = findEarliestTxDate(vatFilter);
  if (!earliestTxDate) return [];

  const allPayments = findHmrcPayments({
    patterns: HMRC_PATTERNS.VAT,
    accounts: businessPaymentAccounts(),
    startDate: '0000-01-01',
    endDate: '9999-12-31',
  });
  const firstVatPaymentDate = allPayments.length > 0
    ? allPayments.reduce((min, p) => (p.date < min ? p.date : min), allPayments[0].date)
    : null;

  // Canvas needs to extend back far enough that the matcher can attribute a
  // pre-data payment to the correct quarter. We anchor at the earliest
  // transaction date but extend further back if the first observed VAT
  // payment predates it by less than one proximity window.
  const canvasStart = firstVatPaymentDate && firstVatPaymentDate < earliestTxDate
    ? shiftIsoDate(firstVatPaymentDate, -DEFAULT_MAX_PROXIMITY_DAYS)
    : earliestTxDate;

  const quarters = enumerateQuartersFromDate(canvasStart, referenceDate);
  const candidateQuarters = quarters.filter(q => q.endDate >= canvasStart);

  const paymentByQuarter = matchPaymentsToSlots(
    candidateQuarters.map(q => ({ key: vatQuarterKey(q), dueDate: q.dueDate })),
    allPayments,
    DEFAULT_MAX_PROXIMITY_DAYS,
  );
  const fyCutoff = getPreviousFyStartDate(referenceDate);

  // Trusted window for "unpaid" vs `insufficient-data` only applies once we
  // have seen at least one VAT settlement line. Otherwise `fyCutoff` would
  // mark every historical quarter ending before last FY as outside range
  // (row never inserted) even when the quarter has income and no VAT match.
  const dataCutoff: string | null = firstVatPaymentDate
    ? (firstVatPaymentDate > fyCutoff ? firstVatPaymentDate : fyCutoff)
    : null;

  return candidateQuarters.map(q => {
    const income = sumIncomeForQuarter(q, vatFilter);
    const match = paymentByQuarter.get(vatQuarterKey(q)) ?? null;
    let reconciliation = reconcileVatQuarter(
      q, income, VAT.FRACTION, match, referenceDate, dataCutoff,
    );
    if (isPartialFirstQuarterBeforeLedger(q, earliestTxDate, match !== null)) {
      reconciliation = {
        ...reconciliation,
        status: 'insufficient-data',
        paidAmount: 0,
        paidDate: null,
        paidFromAccount: null,
      };
    }
    return { quarter: q, income, reconciliation };
  });
}

function findEarliestTxDate(vatFilter: AccountFilterResult): string | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT MIN(date) as minDate FROM transactions WHERE 1=1 ${vatFilter.clause}`
  ).get(...vatFilter.params) as { minDate: string | null } | undefined;
  return row?.minDate ?? null;
}

function sumIncomeForQuarter(q: VatQuarterRange, vatFilter: AccountFilterResult): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE type = 'income' AND date >= ? AND date <= ? ${vatFilter.clause}
  `).get(q.startDate, q.endDate, ...vatFilter.params) as { total: number };
  return row.total;
}

/**
 * Enumerate every distinct VAT quarter covering the period from `fromIso`
 * (inclusive) up to `now`. Uses `getVatQuarterForDate` as the canonical
 * calendar so the output mirrors whatever VAT scheme the business is on.
 */
function enumerateQuartersFromDate(fromIso: string, now: Date): VatQuarterRange[] {
  const startDate = new Date(`${fromIso}T12:00:00`);
  const quarters: VatQuarterRange[] = [];
  const seen = new Set<string>();

  const cursor = new Date(startDate);
  while (cursor <= now) {
    const q = getVatQuarterForDate(cursor);
    const key = vatQuarterKey(q);
    if (!seen.has(key)) {
      seen.add(key);
      quarters.push(q);
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return quarters;
}

/**
 * Status values that justify inserting an obligation row. Anything else
 * (notably `insufficient-data`) is skipped so the Overdue hero and registry
 * never misrepresent coverage we cannot honestly claim.
 */
const INSERTABLE_STATUSES: ReadonlySet<string> = new Set(['paid', 'unpaid', 'not-yet-due']);

export function deriveAndInsertAutoObligations(): void {
  const db = getDb();
  db.prepare("DELETE FROM financial_obligations WHERE source = 'auto'").run();

  const rows = buildVatReconciliationSet();
  let count = 0;

  for (const { quarter: q, reconciliation: recon } of rows) {
    if (!INSERTABLE_STATUSES.has(recon.status)) continue;

    // A zero-£ obligation cannot meaningfully be "unpaid" — there is nothing
    // to pay. Surfacing these as overdue creates the nonsense "£0 overdue VAT"
    // row the user specifically flagged. Skip them; if HMRC ever chases the
    // user over a zero-turnover quarter the manual obligation UI still works.
    if (recon.status === 'unpaid' && recon.expectedAmount === 0) continue;

    const id = `auto-vat-${q.startDate}`;

    // User-level suppression: skip slots the user has explicitly hidden.
    if (isDismissed(id)) continue;

    insertAutoObligation({
      id,
      type: 'vat',
      name: `VAT ${q.label}`,
      entity: 'HMRC',
      frequency: 'quarterly',
      expectedAmount: recon.expectedAmount,
      dueDate: q.dueDate,
      status: recon.status,
      paidAmount: recon.paidAmount > 0 ? recon.paidAmount : null,
      paidDate: recon.paidDate,
      paidFromAccount: recon.paidFromAccount,
      notes: null,
    });
    count++;
  }
  if (count > 0) {
    console.log(`[Database] Derived ${count} auto VAT obligation(s) from transaction data`);
  }
}

export type { HmrcPaymentMatch };
