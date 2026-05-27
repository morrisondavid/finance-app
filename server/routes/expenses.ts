import express, { Request, Response } from 'express';
import type {
  AdHocExpensesResponse,
  AdHocMerchantSeriesResponse,
  ExpensesSheetResponse,
  RecurringExpensesResponse,
} from '../../shared/api-contracts.js';
import { sendJsonMutation } from '../http/mutation/send-json-mutation.js';
import { mutateSimulationExclusionsReplace } from '../http/mutation/expenses-simulation.js';
import { sendJsonRead } from '../http/read/send-json-read.js';
import {
  readFixedExpensesAdHocFromQuery,
  readFixedExpensesAdHocSeriesFromQuery,
  readFixedExpensesOverview,
  readFixedExpensesRecurringFromQuery,
  readFixedExpensesSimulationExclusions,
  readFixedExpensesSnapshotFromQuery,
} from '../http/read/expenses-read.js';

export { accKey } from '../utils/recurring-pipeline.js';

const router = express.Router();

router.get('/overview', (_req: Request<object, ExpensesSheetResponse, object>, res: Response) => {
  sendJsonRead(res, readFixedExpensesOverview());
});

router.get('/simulation-exclusions', (_req, res) => {
  sendJsonRead(res, readFixedExpensesSimulationExclusions());
});

router.put('/simulation-exclusions', (req, res) => {
  sendJsonMutation(res, mutateSimulationExclusionsReplace(req.body));
});

interface AdHocQuery {
  account?: string;
  financialYear?: string;
  min?: string;
  limit?: string;
}

interface AdHocSeriesQuery {
  account?: string;
  financialYear?: string;
  bucketKey?: string;
}

interface RecurringQuery {
  account?: string;
  financialYear?: string;
}

router.get(
  '/ad-hoc/series',
  (req: Request<object, AdHocMerchantSeriesResponse, object, AdHocSeriesQuery>, res: Response) => {
    sendJsonRead(res, readFixedExpensesAdHocSeriesFromQuery(req.query));
  },
);

router.get('/ad-hoc', (req: Request<object, AdHocExpensesResponse, object, AdHocQuery>, res: Response) => {
  sendJsonRead(res, readFixedExpensesAdHocFromQuery(req.query));
});

router.get(
  '/recurring',
  (req: Request<object, RecurringExpensesResponse, object, RecurringQuery>, res: Response) => {
    sendJsonRead(res, readFixedExpensesRecurringFromQuery(req.query));
  },
);

router.get('/snapshot', (req: Request, res: Response) => {
  sendJsonRead(res, readFixedExpensesSnapshotFromQuery(req.query as Record<string, string | undefined>));
});

export default router;
