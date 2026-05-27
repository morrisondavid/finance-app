import express, { Request, Response } from 'express';
import type { BudgetsListResponse, BudgetUpsertBody } from '../../shared/api-contracts.js';
import { sendJsonMutation } from '../http/mutation/send-json-mutation.js';
import { mutateBudgetUpsert, mutateBudgetDelete } from '../http/mutation/budgets.js';

import { sendJsonRead } from '../http/read/send-json-read.js';
import { readBudgetCategoryNames, readBudgetLinesFromQuery } from '../http/read/budgets-read.js';

const router = express.Router();

router.get('/category-names', (_req, res: Response) => {
  sendJsonRead(res, readBudgetCategoryNames());
});

interface BudgetListQuery {
  account?: string;
}

router.get('/', (req: Request<object, BudgetsListResponse, object, BudgetListQuery>, res: Response) => {
  sendJsonRead(res, readBudgetLinesFromQuery(req.query));
});

router.post('/', (req: Request<object, unknown, BudgetUpsertBody>, res: Response) => {
  sendJsonMutation(res, mutateBudgetUpsert(req.body));
});

router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  sendJsonMutation(res, mutateBudgetDelete(req.params.id));
});

export default router;
