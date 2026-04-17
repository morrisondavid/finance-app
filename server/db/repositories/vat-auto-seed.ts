import { getDb } from '../connection.js';
import { VAT, getVatQuarterForDate, type VatQuarterRange } from '../../config/tax-rates.js';
import { HMRC_PATTERNS } from '../../config/payees.js';
import { ACCOUNTS } from '../../types.js';
import { findHmrcPayments } from './tax.js';
import { insertAutoObligation } from './obligations.js';
import { reconcileVatQuarter } from '../../utils/vat-reconciliation.js';
import { formatDateISO } from '../../../shared/date-format.js';
import { getPreviousFyStartDate } from '../utils/financial-year.js';

function iterateHistoricalQuarters(): VatQuarterRange[] {
  const db = getDb();
  const oldest = db.prepare(
    `SELECT MIN(date) as minDate FROM transactions WHERE type = 'income'`
  ).get() as { minDate: string | null };
  if (!oldest?.minDate) return [];

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
  return quarters;
}

export function deriveAndInsertAutoObligations(): void {
  const db = getDb();
  const quarters = iterateHistoricalQuarters();
  const now = new Date();
  const dataCutoff = getPreviousFyStartDate(now);
  let count = 0;

  for (const q of quarters) {
    const incomeResult = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions WHERE type = 'income' AND date >= ? AND date <= ?
    `).get(q.startDate, q.endDate) as { total: number };

    const quarterIncome = incomeResult.total;

    const payments = findHmrcPayments({
      patterns: HMRC_PATTERNS.VAT,
      accounts: [...ACCOUNTS],
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
