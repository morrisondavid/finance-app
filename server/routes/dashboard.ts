import express, { Request, Response } from 'express';
import {
  validateAccount,
  accountBalanceForApi,
} from '../domain/accounts/index.js';
import { getAccountBalance, setOpeningBalance } from '../db/index.js';
import {
  AccountBalanceResponseSchema,
  type AccountBalanceResponse,
} from '../../shared/api-contracts.js';
import { sendJsonRead } from '../http/read/send-json-read.js';
import {
  readDashboardSummaryFromQuery,
  readDashboardBalance,
  readDashboardAccounts,
  readDashboardFeedToolbarStateFromQuery,
  readDashboardCategoriesFromQuery,
  readDashboardTransactionsFromQuery,
} from '../http/read/dashboard.js';

const router = express.Router();

interface SummaryQuery {
  financialYear?: string;
  account?: string;
}

router.get('/summary', (req: Request<object, object, object, SummaryQuery>, res: Response) => {
  sendJsonRead(
    res,
    readDashboardSummaryFromQuery({
      financialYear: typeof req.query.financialYear === 'string' ? req.query.financialYear : undefined,
      account: typeof req.query.account === 'string' ? req.query.account : undefined,
    }),
  );
});

router.get(
  '/balance/:account',
  (req: Request<{ account: string }, object, object, SummaryQuery>, res: Response) => {
    sendJsonRead(
      res,
      readDashboardBalance(req.params.account, {
        financialYear:
          typeof req.query.financialYear === 'string' ? req.query.financialYear : undefined,
      }),
    );
  },
);

interface SetBalanceBody {
  balance: number;
  date?: string;
}

router.post(
  '/balance/:account',
  (req: Request<{ account: string }, AccountBalanceResponse, SetBalanceBody>, res: Response) => {
    try {
      const { account } = req.params;
      const { balance, date } = req.body;

      if (typeof balance !== 'number') {
        res.status(400).json({ error: 'Balance must be a number' });
        return;
      }

      const validatedAccount = validateAccount(account);
      setOpeningBalance(validatedAccount, balance, date);

      const updated = getAccountBalance(validatedAccount);
      res.json(AccountBalanceResponseSchema.parse(accountBalanceForApi(validatedAccount, updated)));
    } catch (error) {
      console.error('Error setting balance:', error);
      res.status(500).json({ error: 'Failed to set balance' });
    }
  },
);

router.get('/accounts', (_req: Request, res: Response) => {
  sendJsonRead(res, readDashboardAccounts());
});

interface FeedToolbarStateQuery {
  account?: string;
}

router.get(
  '/feed-toolbar-state',
  (req: Request<object, object, object, FeedToolbarStateQuery>, res: Response) => {
    sendJsonRead(
      res,
      readDashboardFeedToolbarStateFromQuery({
        account: typeof req.query.account === 'string' ? req.query.account : undefined,
      }),
    );
  },
);

interface CategoriesQuery {
  account?: string;
  financialYear?: string;
}

router.get('/categories', (req: Request<object, object, object, CategoriesQuery>, res: Response) => {
  sendJsonRead(
    res,
    readDashboardCategoriesFromQuery({
      account: typeof req.query.account === 'string' ? req.query.account : undefined,
      financialYear:
        typeof req.query.financialYear === 'string' ? req.query.financialYear : undefined,
    }),
  );
});

router.get('/transactions', (req: Request, res: Response) => {
  sendJsonRead(res, readDashboardTransactionsFromQuery(req.query as Record<string, unknown>));
});

export default router;
