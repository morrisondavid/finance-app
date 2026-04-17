import { getDb } from '../connection.js';
import { VAT, getVatQuarterForDate, type VatQuarterRange } from '../../config/tax-rates.js';
import { HMRC_PATTERNS } from '../../config/payees.js';
import { getBusinessPaymentAccounts } from '../../types.js';
import { findHmrcPayments } from './tax.js';
import { insertAutoObligation } from './obligations.js';
import { reconcileVatQuarter } from '../../utils/vat-reconciliation.js';
import { formatDateISO } from '../../../shared/date-format.js';
import { getPreviousFyStartDate } from '../utils/financial-year.js';
import { buildVatAccountFilter } from '../utils/tax-account-filter.js';

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
  const { quarters, earliestDate } = iterateHistoricalQuarters();
  const vatFilter = buildVatAccountFilter();
  const now = new Date();
  const dataCutoff = getPreviousFyStartDate(now);
  let count = 0;

  for (const q of quarters) {
    if (earliestDate && q.startDate < earliestDate) {
      continue;
    }

    const incomeResult = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions WHERE type = 'income' AND date >= ? AND date <= ? ${vatFilter.clause}
    `).get(q.startDate, q.endDate, ...vatFilter.params) as { total: number };

    const quarterIncome = incomeResult.total;

    const payments = findHmrcPayments({
      patterns: HMRC_PATTERNS.VAT,
      accounts: getBusinessPaymentAccounts(),
      startDate: q.startDate,
      endDate: formatDateISO(new Date(new Date(q.dueDate).getTime() + 60 * 86400000)),
    });

    const recon = reconcileVatQuarter(q, quarterIncome, VAT.FRACTION, payments, now, dataCutoff);

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
