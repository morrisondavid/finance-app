import express, { Request, Response } from 'express';
import { validateAccount } from '../domain/accounts/index.js';
import type { BudgetsListResponse, BudgetUpsertBody } from '../../shared/api-contracts.js';
import { CATEGORY_NAMES } from '../utils/categorizer.js';
import { listBudgets } from '../db/repositories/budgets.js';
import { sendJsonMutation } from '../http/mutation/send-json-mutation.js';
import { mutateBudgetUpsert, mutateBudgetDelete } from '../http/mutation/budgets.js';

const router = express.Router();

router.get('/category-names', (_req, res: Response) => {
  res.json({ categories: [...CATEGORY_NAMES] });
});

interface BudgetListQuery {
  account?: string;
}

router.get('/', (req: Request<object, BudgetsListResponse, object, BudgetListQuery>, res: Response) => {
  try {
    const selectedAccount = validateAccount(req.query.account);
    const budgets = listBudgets({ account: selectedAccount });
    res.json({ budgets });
  } catch (error) {
    console.error('[Budgets] GET error:', error);
    res.status(500).json({ error: 'Failed to list budgets' });
  }
});

router.post('/', (req: Request<object, unknown, BudgetUpsertBody>, res: Response) => {
  sendJsonMutation(res, mutateBudgetUpsert(req.body));
});

router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  sendJsonMutation(res, mutateBudgetDelete(req.params.id));
});

export default router;
