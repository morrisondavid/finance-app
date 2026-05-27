import express, { Request, Response } from 'express';
import type { ObligationRow, Dismissal } from '../../shared/api-contracts.js';
import { sendJsonMutation } from '../http/mutation/send-json-mutation.js';
import {
  mutateFinancialObligationsCreate,
  mutateFinancialObligationsDelete,
  mutateFinancialObligationsDismissAuto,
  mutateFinancialObligationsResetState,
  mutateFinancialObligationsUndismissAuto,
  mutateFinancialObligationsUpdate,
  mutateFinancialObligationsUpsertState,
} from '../http/mutation/obligations.js';
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
  sendJsonMutation(res, mutateFinancialObligationsDismissAuto(req.body));
});

/**
 * Remove a dismissal (undismiss). Reseeds so the row returns immediately
 * when the user undoes their hide.
 */
router.delete('/dismissals/:id', (req: Request, res: Response<{ success: boolean } | { error: string }>) => {
  const rawId = req.params.id;
  const dismissalId = Array.isArray(rawId) ? rawId[0] : rawId;
  sendJsonMutation(res, mutateFinancialObligationsUndismissAuto(dismissalId));
});

router.post('/', (req: Request, res: Response<ObligationRow | { error: string }>) => {
  sendJsonMutation(res, mutateFinancialObligationsCreate(req.body));
});

router.put('/:id', (req: Request<{ id: string }>, res: Response<ObligationRow | { error: string }>) => {
  sendJsonMutation(res, mutateFinancialObligationsUpdate(req.params.id, req.body));
});

/**
 * Upsert a user-authored state row for a manual obligation (Mark Paid,
 * Mark Unpaid, explicit status override). Writes to
 * `obligation-state.csv` with `source=user` so the auto-matcher
 * (obligation-state-matcher) never overwrites it. Rejects `auto-*`
 * ids — those are owned by the HMRC seeders and would be regenerated.
 */
router.post('/:id/state', (req: Request<{ id: string }>, res: Response<ObligationRow | { error: string }>) => {
  sendJsonMutation(res, mutateFinancialObligationsUpsertState(req.params.id, req.body));
});

/**
 * Reset any user-authored or auto-derived state row back to the
 * default projection (Undo Mark Paid, restore auto-matcher control).
 * Returns 404 if there was nothing to reset.
 */
router.delete('/:id/state', (req: Request<{ id: string }>, res: Response<{ success: boolean } | { error: string }>) => {
  sendJsonMutation(res, mutateFinancialObligationsResetState(req.params.id));
});

router.delete('/:id', (req: Request<{ id: string }>, res: Response<{ success: boolean } | { error: string }>) => {
  sendJsonMutation(res, mutateFinancialObligationsDelete(req.params.id));
});

export default router;
