import express, { Request, Response } from 'express';
import {
  getFinancialYearRange,
  getObligationsPageWindow,
} from '../db/utils/financial-year.js';
import { buildVatReconciliationSet } from '../db/repositories/vat-auto-seed.js';
import {
  getAllObligations,
  getUpcomingObligations,
  getOverdueObligations,
  createManualObligation,
  updateManualObligation,
  deleteManualObligation,
  upsertManualObligationState,
  resetManualObligationState,
  NonManualStateError,
  getObligationById,
  toApiObligation,
} from '../db/repositories/obligations.js';
import { deriveAndInsertAutoSaObligations } from '../db/repositories/sa-auto-seed.js';
import { deriveAndInsertAutoObligations as deriveAndInsertAutoVatObligations } from '../db/repositories/vat-auto-seed.js';
import { deriveAndInsertAutoCtObligations } from '../db/repositories/ct-auto-seed.js';
import { deriveAndInsertAutoTtpObligations } from '../db/repositories/hmrc-ttp-auto-seed.js';
import {
  addDismissal,
  removeDismissal,
  listDismissals,
  isAutoObligationId,
  NonAutoDismissalError,
} from '../db/repositories/obligation-dismissals.js';
import {
  CreateObligationBodySchema,
  UpdateObligationBodySchema,
  CreateDismissalBodySchema,
  ObligationStateUpsertBodySchema,
  type ObligationsListResponse,
  type VatReconciliationResponse,
  type UpcomingObligationsResponse,
  type OverdueObligationsResponse,
  type UpcomingPaymentsResponse,
  type UpcomingPaymentItem,
  type ObligationRow,
  type Dismissal,
  type DismissalsListResponse,
} from '../../shared/api-contracts.js';
import { runExpensesOverviewPipeline } from '../utils/expenses-overview-pipeline.js';
import { buildUpcomingRecurring } from '../utils/recurring-upcoming.js';

const router = express.Router();

function parseBooleanQueryParam(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalised = value.trim().toLowerCase();
  return normalised === '1' || normalised === 'true' || normalised === 'yes';
}

/**
 * Rerun auto-seeders affected by a mutation so the manual↔auto supersede
 * state is reflected immediately instead of lingering until the next
 * restart. Dispatched by obligation `type`:
 *   - `self-assessment`  → SA seeder
 *   - `corporation-tax`  → CT seeder
 *
 * Failures are logged but never block the HTTP response.
 */
function resyncAutoSeedersForTypes(types: Array<string | undefined | null>): void {
  const affected = new Set(types.filter((t): t is string => typeof t === 'string'));
  if (affected.has('self-assessment')) {
    try {
      deriveAndInsertAutoSaObligations();
    } catch (err) {
      console.error('[Obligations] SA resync after mutation failed:', err);
    }
  }
  if (affected.has('corporation-tax')) {
    try {
      deriveAndInsertAutoCtObligations();
    } catch (err) {
      console.error('[Obligations] CT resync after mutation failed:', err);
    }
  }
}

/**
 * Rerun the auto-seeder responsible for the given dismissed obligation id
 * so the seeded set in `financial_obligations` is brought in line with the
 * dismissal state immediately (no stale row waiting for the next restart).
 *
 * Id prefix dispatch keeps this trivially extensible: new auto seeders just
 * need a `auto-<kind>-...` prefix and a case here.
 */
function resyncSeederForAutoId(obligationId: string): void {
  try {
    if (obligationId.startsWith('auto-sa-')) {
      deriveAndInsertAutoSaObligations();
    } else if (obligationId.startsWith('auto-vat-')) {
      deriveAndInsertAutoVatObligations();
    } else if (obligationId.startsWith('auto-ct-')) {
      deriveAndInsertAutoCtObligations();
    } else if (obligationId.startsWith('auto-ttp-')) {
      deriveAndInsertAutoTtpObligations();
    }
  } catch (err) {
    console.error('[Obligations] Dismissal resync failed:', err);
  }
}

/**
 * Registry feed for the Obligations page. Bounded by the shared rolling
 * ±12-month window so the table stays aligned with every other section
 * on the page (overdue hero, upcoming list, unmatched HMRC feed). The
 * legacy `financialYear` query param is still honoured for external /
 * historical callers (dashboard, tests) — explicit min/max takes
 * precedence when both are supplied.
 */
router.get('/', (req: Request, res: Response<ObligationsListResponse | { error: string }>) => {
  try {
    const { status, type, source, hideCompleted, financialYear } = req.query;
    const window = getObligationsPageWindow();
    const rows = getAllObligations({
      status: typeof status === 'string' ? status : undefined,
      type: typeof type === 'string' ? type : undefined,
      source: typeof source === 'string' ? source : undefined,
      hideCompleted: parseBooleanQueryParam(hideCompleted),
      financialYear: typeof financialYear === 'string' ? financialYear : undefined,
      minDueDate: window.startDate,
      maxDueDate: window.endDate,
    });
    res.json({ obligations: rows.map(toApiObligation) });
  } catch (error) {
    console.error('Error fetching obligations:', error);
    res.status(500).json({ error: 'Failed to fetch obligations' });
  }
});

router.get('/overdue', (_req: Request, res: Response<OverdueObligationsResponse | { error: string }>) => {
  try {
    const window = getObligationsPageWindow();
    const rows = getOverdueObligations({ minDueDate: window.startDate });
    res.json({ obligations: rows.map(toApiObligation) });
  } catch (error) {
    console.error('Error fetching overdue obligations:', error);
    res.status(500).json({ error: 'Failed to fetch overdue obligations' });
  }
});

router.get('/vat-reconciliation', (req: Request, res: Response<VatReconciliationResponse | { error: string }>) => {
  try {
    const fyParam = typeof req.query.financialYear === 'string' ? req.query.financialYear : undefined;
    const fyRange = fyParam ? getFinancialYearRange(fyParam) : undefined;

    // Single source of truth: auto-seed and this endpoint share the same
    // quarter enumeration + matching logic so the UI cannot show a quarter
    // the auto-seeder would have dropped (or vice versa).
    const rows = buildVatReconciliationSet();

    const quarters: VatReconciliationResponse['quarters'] = [];
    for (const { quarter: q, reconciliation: recon } of rows) {
      if (fyRange && (q.endDate < fyRange.startDate || q.startDate > fyRange.endDate)) continue;
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
    res.json({ obligations: rows.map(toApiObligation) });
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
    // Dedup: a obligation that produces an `UpcomingRecurring`
    // also projects to a `financial_obligations` row when its category is
    // surfaced on the Obligations tab (insurance, tax-manual). Without
    // this filter the user sees each obligation twice. Obligations win
    // because they carry richer state (due date, paid status, person).
    const obligationIds = new Set(
      obligationItems.flatMap(o => o.kind === 'obligation' ? [o.id] : []),
    );
    const recurringItems: UpcomingPaymentItem[] = recurring
      .filter(r => r.declaredObligationId === undefined || !obligationIds.has(r.declaredObligationId))
      .map(r => ({
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

/**
 * List all dismissals. Fuels the "Show dismissed" toggle in the registry
 * so the UI can render greyed-out rows with an Undo action.
 */
router.get('/dismissals', (_req: Request, res: Response<DismissalsListResponse | { error: string }>) => {
  try {
    const dismissals = listDismissals();
    res.json({ dismissals });
  } catch (error) {
    console.error('Error listing dismissals:', error);
    res.status(500).json({ error: 'Failed to list dismissals' });
  }
});

/**
 * Dismiss an auto-seeded obligation by id. The row is removed from
 * `financial_obligations` on the next seeder run (triggered here) and will
 * not reappear on subsequent starts/reseeds until explicitly undismissed.
 */
router.post('/dismissals', (req: Request, res: Response<Dismissal | { error: string }>) => {
  try {
    const parsed = CreateDismissalBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: `Invalid body: ${parsed.error.issues.map(i => i.message).join(', ')}` });
      return;
    }

    try {
      const saved = addDismissal({
        obligationId: parsed.data.obligationId,
        reason: parsed.data.reason ?? null,
      });
      resyncSeederForAutoId(saved.obligationId);
      res.status(201).json(saved);
    } catch (err) {
      if (err instanceof NonAutoDismissalError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  } catch (error) {
    console.error('Error creating dismissal:', error);
    res.status(500).json({ error: 'Failed to create dismissal' });
  }
});

/**
 * Remove a dismissal (undismiss). Reseeds so the row returns immediately
 * when the user undoes their hide.
 */
router.delete('/dismissals/:id', (req: Request, res: Response<{ success: boolean } | { error: string }>) => {
  try {
    const obligationId = req.params.id;
    if (typeof obligationId !== 'string' || !isAutoObligationId(obligationId)) {
      res.status(400).json({ error: 'Dismissal id must be an auto-* obligation id' });
      return;
    }
    const removed = removeDismissal(obligationId);
    if (!removed) {
      res.status(404).json({ error: 'Dismissal not found' });
      return;
    }
    resyncSeederForAutoId(obligationId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing dismissal:', error);
    res.status(500).json({ error: 'Failed to remove dismissal' });
  }
});

router.post('/', (req: Request, res: Response<ObligationRow | { error: string }>) => {
  try {
    const parsed = CreateObligationBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: `Invalid body: ${parsed.error.issues.map(i => i.message).join(', ')}` });
      return;
    }
    const row = createManualObligation(parsed.data);
    resyncAutoSeedersForTypes([row.type]);
    res.status(201).json(toApiObligation(row));
  } catch (error) {
    console.error('Error creating obligation:', error);
    res.status(500).json({ error: 'Failed to create obligation' });
  }
});

router.put('/:id', (req: Request<{ id: string }>, res: Response<ObligationRow | { error: string }>) => {
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
    resyncAutoSeedersForTypes([existing.type, updated.type]);
    res.json(toApiObligation(updated));
  } catch (error) {
    console.error('Error updating obligation:', error);
    res.status(500).json({ error: 'Failed to update obligation' });
  }
});

/**
 * Upsert a user-authored state row for a manual obligation (Mark Paid,
 * Mark Unpaid, explicit status override). Writes to
 * `obligation-state.csv` with `source=user` so the auto-matcher
 * (obligation-state-matcher) never overwrites it. Rejects `auto-*`
 * ids — those are owned by the HMRC seeders and would be regenerated.
 */
router.post('/:id/state', (req: Request<{ id: string }>, res: Response<ObligationRow | { error: string }>) => {
  try {
    const parsed = ObligationStateUpsertBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: `Invalid body: ${parsed.error.issues.map(i => i.message).join(', ')}` });
      return;
    }
    try {
      const row = upsertManualObligationState(req.params.id, parsed.data);
      if (!row) { res.status(404).json({ error: 'Obligation not found' }); return; }
      res.json(toApiObligation(row));
    } catch (err) {
      if (err instanceof NonManualStateError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  } catch (error) {
    console.error('Error upserting obligation state:', error);
    res.status(500).json({ error: 'Failed to update obligation state' });
  }
});

/**
 * Reset any user-authored or auto-derived state row back to the
 * default projection (Undo Mark Paid, restore auto-matcher control).
 * Returns 404 if there was nothing to reset.
 */
router.delete('/:id/state', (req: Request<{ id: string }>, res: Response<{ success: boolean } | { error: string }>) => {
  try {
    try {
      const removed = resetManualObligationState(req.params.id);
      if (!removed) { res.status(404).json({ error: 'No state override to reset' }); return; }
      res.json({ success: true });
    } catch (err) {
      if (err instanceof NonManualStateError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  } catch (error) {
    console.error('Error resetting obligation state:', error);
    res.status(500).json({ error: 'Failed to reset obligation state' });
  }
});

router.delete('/:id', (req: Request<{ id: string }>, res: Response<{ success: boolean } | { error: string }>) => {
  try {
    const existing = getObligationById(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Obligation not found' }); return; }
    if (existing.source !== 'manual') { res.status(403).json({ error: 'Cannot delete auto-derived obligations' }); return; }
    deleteManualObligation(req.params.id);
    resyncAutoSeedersForTypes([existing.type]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting obligation:', error);
    res.status(500).json({ error: 'Failed to delete obligation' });
  }
});

export default router;
