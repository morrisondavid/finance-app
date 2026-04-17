import express, { Request, Response } from 'express';
import { getDb } from '../db/connection.js';
import { HMRC_PATTERNS } from '../config/payees.js';
import { getBusinessPaymentAccounts } from '../types.js';
import { VAT, getVatQuarterForDate, type VatQuarterRange } from '../config/tax-rates.js';
import { findHmrcPayments } from '../db/repositories/tax.js';
import { reconcileVatQuarter } from '../utils/vat-reconciliation.js';
import { matchPaymentsToQuarters, quarterKey } from '../utils/vat-payment-matcher.js';
import { getFinancialYearRange, getPreviousFyStartDate } from '../db/utils/financial-year.js';
import { buildVatAccountFilter } from '../db/utils/tax-account-filter.js';
import {
  getAllObligations,
  getUpcomingObligations,
  getOverdueObligations,
  createManualObligation,
  updateManualObligation,
  deleteManualObligation,
  getObligationById,
  toApiObligation,
} from '../db/repositories/obligations.js';
import {
  CreateObligationBodySchema,
  UpdateObligationBodySchema,
  type ObligationsListResponse,
  type VatReconciliationResponse,
  type UpcomingObligationsResponse,
  type OverdueObligationsResponse,
  type UpcomingPaymentsResponse,
  type UpcomingPaymentItem,
  type Obligation,
} from '../../shared/api-contracts.js';
import { runExpensesOverviewPipeline } from '../utils/expenses-overview-pipeline.js';
import { buildUpcomingRecurring } from '../utils/recurring-upcoming.js';

const router = express.Router();

function parseBooleanQueryParam(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalised = value.trim().toLowerCase();
  return normalised === '1' || normalised === 'true' || normalised === 'yes';
}

router.get('/', (req: Request, res: Response<ObligationsListResponse | { error: string }>) => {
  try {
    const { status, type, source, hideCompleted, financialYear } = req.query;
    const rows = getAllObligations({
      status: typeof status === 'string' ? status : undefined,
      type: typeof type === 'string' ? type : undefined,
      source: typeof source === 'string' ? source : undefined,
      hideCompleted: parseBooleanQueryParam(hideCompleted),
      financialYear: typeof financialYear === 'string' ? financialYear : undefined,
    });
    res.json({ obligations: rows.map(toApiObligation) as Obligation[] });
  } catch (error) {
    console.error('Error fetching obligations:', error);
    res.status(500).json({ error: 'Failed to fetch obligations' });
  }
});

router.get('/overdue', (_req: Request, res: Response<OverdueObligationsResponse | { error: string }>) => {
  try {
    const rows = getOverdueObligations();
    res.json({ obligations: rows.map(toApiObligation) as Obligation[] });
  } catch (error) {
    console.error('Error fetching overdue obligations:', error);
    res.status(500).json({ error: 'Failed to fetch overdue obligations' });
  }
});

router.get('/vat-reconciliation', (req: Request, res: Response<VatReconciliationResponse | { error: string }>) => {
  try {
    const db = getDb();
    const vatFilter = buildVatAccountFilter();
    const oldest = db.prepare(
      `SELECT MIN(date) as minDate FROM transactions WHERE type = 'income' ${vatFilter.clause}`
    ).get(...vatFilter.params) as { minDate: string | null };

    if (!oldest?.minDate) {
      res.json({ quarters: [] });
      return;
    }

    const earliestDate = oldest.minDate;
    const fyParam = typeof req.query.financialYear === 'string' ? req.query.financialYear : undefined;
    const fyRange = fyParam ? getFinancialYearRange(fyParam) : undefined;

    const now = new Date();
    const dataCutoff = getPreviousFyStartDate(now);

    // Enumerate every distinct VAT quarter from the earliest income date to now.
    // Matching is done once against the full candidate set so payments cannot be
    // reused across quarters, matching the auto-seed behaviour exactly.
    const startDate = new Date(`${earliestDate}T12:00:00`);
    const seen = new Set<string>();
    const candidateQuarters: VatQuarterRange[] = [];
    const cursor = new Date(startDate);
    while (cursor <= now) {
      const q = getVatQuarterForDate(cursor);
      const key = `${q.startDate}-${q.endDate}`;
      if (!seen.has(key) && q.startDate >= earliestDate) {
        seen.add(key);
        candidateQuarters.push(q);
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const allPayments = findHmrcPayments({
      patterns: HMRC_PATTERNS.VAT,
      accounts: getBusinessPaymentAccounts(),
      startDate: '0000-01-01',
      endDate: '9999-12-31',
    });
    const paymentByQuarter = matchPaymentsToQuarters(candidateQuarters, allPayments);

    const quarters: VatReconciliationResponse['quarters'] = [];
    for (const q of candidateQuarters) {
      if (fyRange && (q.endDate < fyRange.startDate || q.startDate > fyRange.endDate)) continue;

      const incomeResult = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM transactions WHERE type = 'income' AND date >= ? AND date <= ? ${vatFilter.clause}
      `).get(q.startDate, q.endDate, ...vatFilter.params) as { total: number };

      const match = paymentByQuarter.get(quarterKey(q)) ?? null;
      const recon = reconcileVatQuarter(q, incomeResult.total, VAT.FRACTION, match, now, dataCutoff);

      quarters.push({
        quarterLabel: q.label,
        startDate: q.startDate,
        endDate: q.endDate,
        dueDate: q.dueDate,
        quarter: q.quarter,
        expectedAmount: recon.expectedAmount,
        paidAmount: recon.paidAmount,
        paidDate: recon.paidDate,
        paidFromAccount: recon.paidFromAccount,
        status: recon.status,
      });
    }

    quarters.sort((a, b) => a.startDate.localeCompare(b.startDate));
    res.json({ quarters });
  } catch (error) {
    console.error('Error in VAT reconciliation:', error);
    res.status(500).json({ error: 'Failed to generate VAT reconciliation' });
  }
});

router.get('/upcoming', (req: Request, res: Response<UpcomingObligationsResponse | { error: string }>) => {
  try {
    const days = parseInt(String(req.query.days ?? '90'), 10) || 90;
    const rows = getUpcomingObligations(days);
    res.json({ obligations: rows.map(toApiObligation) as Obligation[] });
  } catch (error) {
    console.error('Error fetching upcoming obligations:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming obligations' });
  }
});

/**
 * Merged feed of non-completed obligations + predicted annual recurring charges,
 * sorted by soonest date. Monthly recurring items are intentionally excluded —
 * they live in the Fixed Expenses / Budget surfaces, not on the Obligations page.
 */
router.get('/upcoming-payments', (req: Request, res: Response<UpcomingPaymentsResponse | { error: string }>) => {
  try {
    const days = parseInt(String(req.query.days ?? '365'), 10) || 365;

    const obligationItems: UpcomingPaymentItem[] = getUpcomingObligations(days)
      .filter(row => row.due_date !== null)
      .map(row => ({
        kind: 'obligation',
        id: row.id,
        type: row.type,
        name: row.name,
        entity: row.entity,
        expectedAmount: row.expected_amount,
        dueDate: row.due_date as string,
        status: row.status,
        source: row.source,
      }));

    const pipeline = runExpensesOverviewPipeline();
    const recurring = buildUpcomingRecurring(pipeline, new Date()).thisYear;
    const recurringItems: UpcomingPaymentItem[] = recurring.map(r => ({
      kind: 'recurring',
      merchant: r.merchant,
      category: r.category,
      colour: r.colour,
      logoUrl: r.logoUrl,
      amount: r.amount,
      sourceAccount: r.sourceAccount,
      nextExpectedDate: r.nextExpectedDate,
    }));

    const items = [...obligationItems, ...recurringItems].sort((a, b) => {
      const dateA = a.kind === 'obligation' ? a.dueDate : a.nextExpectedDate;
      const dateB = b.kind === 'obligation' ? b.dueDate : b.nextExpectedDate;
      return dateA.localeCompare(dateB);
    });

    res.json({ items });
  } catch (error) {
    console.error('Error fetching upcoming payments:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming payments' });
  }
});

router.post('/', (req: Request, res: Response<Obligation | { error: string }>) => {
  try {
    const parsed = CreateObligationBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: `Invalid body: ${parsed.error.issues.map(i => i.message).join(', ')}` });
      return;
    }
    const row = createManualObligation(parsed.data);
    res.status(201).json(toApiObligation(row) as Obligation);
  } catch (error) {
    console.error('Error creating obligation:', error);
    res.status(500).json({ error: 'Failed to create obligation' });
  }
});

router.put('/:id', (req: Request, res: Response<Obligation | { error: string }>) => {
  try {
    const existing = getObligationById(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Obligation not found' }); return; }
    if (existing.source !== 'manual') { res.status(403).json({ error: 'Cannot edit auto-derived obligations' }); return; }

    const parsed = UpdateObligationBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: `Invalid body: ${parsed.error.issues.map(i => i.message).join(', ')}` });
      return;
    }
    const updated = updateManualObligation(req.params.id, parsed.data);
    if (!updated) { res.status(404).json({ error: 'Obligation not found' }); return; }
    res.json(toApiObligation(updated) as Obligation);
  } catch (error) {
    console.error('Error updating obligation:', error);
    res.status(500).json({ error: 'Failed to update obligation' });
  }
});

router.delete('/:id', (req: Request, res: Response<{ success: boolean } | { error: string }>) => {
  try {
    const existing = getObligationById(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Obligation not found' }); return; }
    if (existing.source !== 'manual') { res.status(403).json({ error: 'Cannot delete auto-derived obligations' }); return; }
    deleteManualObligation(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting obligation:', error);
    res.status(500).json({ error: 'Failed to delete obligation' });
  }
});

export default router;
