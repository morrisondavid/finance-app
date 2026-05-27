/**
 * /api/debts — CRUD for external creditor debts.
 *
 * All mutating endpoints: validate body with Zod → mutate SQLite via the
 * repository (which also re-exports the canonical debts.csv) → return the
 * refreshed entity so the client can re-render without a second fetch.
 */

import express, { Request, Response } from 'express';
import {
  getDebt,
  getDebtSummary,
  getAllDebtSummaries,
} from '../db/repositories/debts.js';
import { sendJsonMutation } from '../http/mutation/send-json-mutation.js';
import {
  mutateDebtsCreate,
  mutateDebtsUpdate,
  mutateDebtsArchive,
  mutateDebtsOpeningBalance,
} from '../http/mutation/debts.js';

const router = express.Router();

router.get('/', (req: Request, res: Response) => {
  try {
    const includeArchived = req.query.includeArchived === '1' || req.query.includeArchived === 'true';
    const result = getAllDebtSummaries({ includeArchived });
    res.json(result);
  } catch (error) {
    console.error('[Debts] GET error:', error);
    res.status(500).json({ error: 'Failed to list debts' });
  }
});

router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const debt = getDebt(req.params.id);
    if (!debt) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }
    res.json({ debt: getDebtSummary(debt) });
  } catch (error) {
    console.error('[Debts] GET :id error:', error);
    res.status(500).json({ error: 'Failed to fetch debt' });
  }
});

router.post('/', (req: Request, res: Response) => {
  sendJsonMutation(res, mutateDebtsCreate(req.body));
});

router.put('/:id', (req: Request<{ id: string }>, res: Response) => {
  sendJsonMutation(res, mutateDebtsUpdate(req.params.id, req.body));
});

router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  sendJsonMutation(res, mutateDebtsArchive(req.params.id));
});

router.post('/:id/opening-balance', (req: Request<{ id: string }>, res: Response) => {
  sendJsonMutation(res, mutateDebtsOpeningBalance(req.params.id, req.body));
});

export default router;
