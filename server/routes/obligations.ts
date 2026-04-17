import express, { Request, Response } from 'express';
import { getDb } from '../db/connection.js';
import { HMRC_PATTERNS } from '../config/payees.js';
import { ACCOUNTS } from '../types.js';
import { VAT, getVatQuarterForDate } from '../config/tax-rates.js';
import { findHmrcPayments } from '../db/repositories/tax.js';
import { reconcileVatQuarter } from '../utils/vat-reconciliation.js';
import { formatDateISO } from '../../shared/date-format.js';
import { getFinancialYearRange, getPreviousFyStartDate } from '../db/utils/financial-year.js';
import {
  getAllObligations,
  getUpcomingObligations,
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
  type Obligation,
} from '../../shared/api-contracts.js';

const router = express.Router();

router.get('/', (req: Request, res: Response<ObligationsListResponse | { error: string }>) => {
  try {
    const { status, type, source } = req.query;
    const rows = getAllObligations({
      status: typeof status === 'string' ? status : undefined,
      type: typeof type === 'string' ? type : undefined,
      source: typeof source === 'string' ? source : undefined,
    });
    res.json({ obligations: rows.map(toApiObligation) as Obligation[] });
  } catch (error) {
    console.error('Error fetching obligations:', error);
    res.status(500).json({ error: 'Failed to fetch obligations' });
  }
});

router.get('/vat-reconciliation', (req: Request, res: Response<VatReconciliationResponse | { error: string }>) => {
  try {
    const db = getDb();
    const oldest = db.prepare(
      `SELECT MIN(date) as minDate FROM transactions WHERE type = 'income'`
    ).get() as { minDate: string | null };

    if (!oldest?.minDate) {
      res.json({ quarters: [] });
      return;
    }

    const fyParam = typeof req.query.financialYear === 'string' ? req.query.financialYear : undefined;
    const fyRange = fyParam ? getFinancialYearRange(fyParam) : undefined;

    const now = new Date();
    const dataCutoff = getPreviousFyStartDate(now);

    const startDate = new Date(`${oldest.minDate}T12:00:00`);
    const seen = new Set<string>();
    const quarters: VatReconciliationResponse['quarters'] = [];

    const cursor = new Date(startDate);
    while (cursor <= now) {
      const q = getVatQuarterForDate(cursor);
      const key = `${q.startDate}-${q.endDate}`;
      if (!seen.has(key)) {
        seen.add(key);

        if (fyRange && (q.endDate < fyRange.startDate || q.startDate > fyRange.endDate)) {
          cursor.setMonth(cursor.getMonth() + 1);
          continue;
        }

        const incomeResult = db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as total
          FROM transactions WHERE type = 'income' AND date >= ? AND date <= ?
        `).get(q.startDate, q.endDate) as { total: number };

        const payments = findHmrcPayments({
          patterns: HMRC_PATTERNS.VAT,
          accounts: [...ACCOUNTS],
          startDate: q.startDate,
          endDate: formatDateISO(new Date(new Date(q.dueDate).getTime() + 60 * 86400000)),
        });

        const recon = reconcileVatQuarter(q, incomeResult.total, VAT.FRACTION, payments, now, dataCutoff);

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
      cursor.setMonth(cursor.getMonth() + 1);
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
