import express, { Request, Response } from 'express';
import {
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
  isAutoObligationId,
  NonAutoDismissalError,
} from '../db/repositories/obligation-dismissals.js';
import {
  CreateObligationBodySchema,
  UpdateObligationBodySchema,
  CreateDismissalBodySchema,
  ObligationStateUpsertBodySchema,
  type ObligationRow,
  type Dismissal,
} from '../../shared/api-contracts.js';
import { sendJsonRead } from '../http/read/send-json-read.js';
import {
  readObligationsRegistry,
  readObligationsOverdue,
  readVatReconciliation,
  readUpcomingObligations,
  readUpcomingPaymentsMerged,
  readObligationsDismissals,
} from '../http/read/obligations-read.js';

const router = express.Router();
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

router.get('/', (req: Request, res: Response) => {
  sendJsonRead(res, readObligationsRegistry(req.query as Record<string, unknown>));
});

router.get('/overdue', (_req: Request, res: Response) => {
  sendJsonRead(res, readObligationsOverdue());
});

router.get('/vat-reconciliation', (req: Request, res: Response) => {
  sendJsonRead(res, readVatReconciliation(req.query as Record<string, unknown>));
});

router.get('/upcoming', (req: Request, res: Response) => {
  sendJsonRead(res, readUpcomingObligations(req.query as Record<string, unknown>));
});

router.get('/upcoming-payments', (req: Request, res: Response) => {
  sendJsonRead(res, readUpcomingPaymentsMerged(req.query as Record<string, unknown>));
});

router.get('/dismissals', (_req: Request, res: Response) => {
  sendJsonRead(res, readObligationsDismissals());
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
