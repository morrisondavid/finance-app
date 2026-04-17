import { getDb } from '../connection.js';
import { VAT, getVatQuarterForDate, type VatQuarterRange } from '../../config/tax-rates.js';
import { HMRC_PATTERNS } from '../../config/payees.js';
import { getBusinessPaymentAccounts } from '../../types.js';
import { findHmrcPayments } from './tax.js';
import { insertAutoObligation } from './obligations.js';
import { reconcileVatQuarter } from '../../utils/vat-reconciliation.js';
import { getPreviousFyStartDate } from '../utils/financial-year.js';
import { buildVatAccountFilter } from '../utils/tax-account-filter.js';
import { matchPaymentsToQuarters, quarterKey } from '../../utils/vat-payment-matcher.js';

function iterateHistoricalQuarters(): { quarters: VatQuarterRange[]; earliestDate: string | null } {
  const db = getDb();
  const vatFilter = buildVatAccountFilter();
  const oldest = db.prepare(
    `SELECT MIN(date) as minDate FROM transactions WHERE type = 'income' ${vatFilter.clause}`
  ).get(...vatFilter.params) as { minDate: string | null };
  if (!oldest?.minDate) return { quarters: [], earliestDate: null };

  const startDate = new Date(`${oldest.minDate}T12:00:00`);
  const now = new Date();
  const quarters: VatQuarterRange[] = [];
  const seen = new Set<string>();

  const cursor = new Date(startDate);
  while (cursor <= now) {
    const q = getVatQuarterForDate(cursor);
    const key = `${q.startDate}-${q.endDate}`;
    if (!seen.has(key)) {
      seen.add(key);
      quarters.push(q);
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return { quarters, earliestDate: oldest.minDate };
}

export function deriveAndInsertAutoObligations(): void {
  const db = getDb();
  db.prepare("DELETE FROM financial_obligations WHERE source = 'auto'").run();
  const { quarters, earliestDate } = iterateHistoricalQuarters();
  const vatFilter = buildVatAccountFilter();
  const now = new Date();
  const dataCutoff = getPreviousFyStartDate(now);

  // Only quarters starting on or after the earliest income date are candidates;
  // older quarters have no reliable income figure and are skipped outright.
  const candidateQuarters = earliestDate
    ? quarters.filter(q => q.startDate >= earliestDate)
    : quarters;

  // Fetch the full HMRC VAT payment pool once, then match single payments to
  // quarters via the shared chronological matcher (no cross-quarter reuse).
  const allPayments = findHmrcPayments({
    patterns: HMRC_PATTERNS.VAT,
    accounts: getBusinessPaymentAccounts(),
    startDate: '0000-01-01',
    endDate: '9999-12-31',
  });
  const paymentByQuarter = matchPaymentsToQuarters(candidateQuarters, allPayments);

  let count = 0;
  for (const q of candidateQuarters) {
    const incomeResult = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions WHERE type = 'income' AND date >= ? AND date <= ? ${vatFilter.clause}
    `).get(q.startDate, q.endDate, ...vatFilter.params) as { total: number };

    const match = paymentByQuarter.get(quarterKey(q)) ?? null;
    const recon = reconcileVatQuarter(q, incomeResult.total, VAT.FRACTION, match, now, dataCutoff);

    // Skip inserting obligations we can't reliably judge — keeps the Overdue
    // hero and registry free of unverifiable 2022-era noise.
    if (recon.status === 'insufficient-data') continue;

    insertAutoObligation({
      id: `auto-vat-${q.startDate}`,
      type: 'vat',
      name: `VAT ${q.label}`,
      entity: 'HMRC',
      recurrence: 'quarterly',
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
