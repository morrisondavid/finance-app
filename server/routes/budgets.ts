import express, { Request, Response } from 'express';
import { validateAccount } from '../domain/accounts/index.js';
import type { BudgetsListResponse, BudgetUpsertBody } from '../../shared/api-contracts.js';
import {
  BudgetUpsertBodySchema,
  BudgetRowSchema,
} from '../../shared/api-contracts.js';
import { CATEGORY_NAMES, type CategoryName } from '../utils/categorizer.js';
import { listBudgets, upsertBudget, deleteBudgetById } from '../db/repositories/budgets.js';

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
  try {
    const body = BudgetUpsertBodySchema.parse(req.body);
    if (!CATEGORY_NAMES.includes(body.category as CategoryName)) {
      res.status(400).json({ error: 'Invalid category' });
      return;
    }
    const row = upsertBudget({
      account: body.account,
      category: body.category as CategoryName,
      amount: body.amount,
      period: body.period,
    });
    res.status(201).json(BudgetRowSchema.parse(row));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    if (message.includes('Invalid')) {
      res.status(400).json({ error: message });
      return;
    }
    console.error('[Budgets] POST error:', error);
    res.status(500).json({ error: 'Failed to save budget' });
  }
});

router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const ok = deleteBudgetById(id);
    if (!ok) {
      res.status(404).json({ error: 'Budget not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    console.error('[Budgets] DELETE error:', error);
    res.status(500).json({ error: 'Failed to delete budget' });
  }
});

export default router;
