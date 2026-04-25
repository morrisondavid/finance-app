/**
 * /api/forecast — cash-flow projection endpoint (§1.5).
 *
 * Route map:
 *   GET /api/forecast?days=90&entityId=autonize-it-ltd
 *     — daily-resolution balance projection per account and entity.
 *       `days` defaults to 90; `entityId` is optional (omit for all).
 *
 * Thin route: loads all data sources, feeds them through the pure
 * forecast engine, validates the response through Zod.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ACCOUNTS,
  EntityIdSchema,
  ForecastResponseSchema,
  type AccountName,
  type CurrencyCode,
  type EntityId,
} from '../../shared/api-contracts.js';
import { shiftIsoDate, todayIsoLocal } from '../../shared/iso-date.js';

import { getAllAccountBalances } from '../db/repositories/balance.js';
import { getUpcomingObligations, toApiObligation } from '../db/repositories/obligations.js';
import { runExpensesOverviewPipeline } from '../utils/expenses-overview-pipeline.js';
import { buildUpcomingRecurring } from '../utils/recurring-upcoming.js';
import { listInvoicesByStatus } from '../domain/invoices/index.js';
import { listActiveContracts } from '../domain/contracts/queries.js';
import { allLeave } from '../domain/leave/index.js';
import { holidayDatesForEntity } from '../domain/working-days/public-holidays.js';
import {
  accountsForEntity,
  getAccountConfig,
  getEntityIdForAccount,
} from '../domain/accounts/queries.js';
import { allEntityIds } from '../domain/company/index.js';

import {
  assembleForecastEvents,
  buildForecast,
  type AccountStartingBalance,
} from '../domain/forecast/index.js';

const router = Router();

const QuerySchema = z.object({
  days: z.coerce.number().int().positive().default(90),
  entityId: EntityIdSchema.optional(),
});

const DEFAULT_OBLIGATION_ACCOUNTS = new Map<string, AccountName>([
  ['vat', 'barclays-current'],
  ['corporation-tax', 'barclays-current'],
  ['self-assessment', 'natwest'],
  ['tax-manual', 'barclays-current'],
  ['insurance', 'barclays-current'],
  ['subscription', 'barclays-current'],
  ['other', 'barclays-current'],
]);

function buildCurrencyByAccount(): Map<AccountName, CurrencyCode> {
  const map = new Map<AccountName, CurrencyCode>();
  for (const name of ACCOUNTS) {
    const config = getAccountConfig(name);
    map.set(name, config.currency);
  }
  return map;
}

function buildAccountsByEntity(): Map<EntityId, readonly AccountName[]> {
  const map = new Map<EntityId, readonly AccountName[]>();
  for (const eid of allEntityIds()) {
    map.set(eid, accountsForEntity(eid));
  }
  return map;
}

router.get('/', (req: Request, res: Response) => {
  try {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }

    const { days: horizonDays, entityId: filterEntityId } = parsed.data;
    const today = todayIsoLocal();
    const horizon = shiftIsoDate(today, horizonDays);

    const currencyByAccount = buildCurrencyByAccount();
    const accountsByEntity = buildAccountsByEntity();

    const allBalances = getAllAccountBalances();
    const startingBalances: AccountStartingBalance[] = [];
    for (const name of ACCOUNTS) {
      const entityId = getEntityIdForAccount(name);
      if (filterEntityId !== undefined && entityId !== filterEntityId) continue;
      const bal = allBalances[name];
      startingBalances.push({
        account: name,
        balance: bal.currentBalance,
        currency: currencyByAccount.get(name) ?? 'GBP',
        entityId,
      });
    }

    const obligations = getUpcomingObligations(horizonDays).map(toApiObligation);
    const pipeline = runExpensesOverviewPipeline();
    const todayDate = new Date(today + 'T00:00:00Z');
    const upcomingBuckets = buildUpcomingRecurring(pipeline, todayDate);
    const unpaidInvoices = listInvoicesByStatus('issued');
    const contracts = listActiveContracts();
    const leaveRows = allLeave();
    const yearStart = today.slice(0, 4) + '-01-01';
    const yearEnd = (Number(today.slice(0, 4)) + 1) + '-12-31';
    const entityIds = allEntityIds();
    const publicHolidayDatesByEntity = new Map(
      entityIds.map(eid => [eid, holidayDatesForEntity(eid, yearStart, yearEnd)] as const),
    );

    const allEvents = assembleForecastEvents({
      today,
      horizon,
      defaultAccountByType: DEFAULT_OBLIGATION_ACCOUNTS,
      currencyByAccount,
      accountsByEntity,
      obligations,
      pipeline,
      upcomingBuckets,
      unpaidInvoices,
      contracts,
      leaveRows,
      publicHolidayDatesByEntity,
      includeInvoiceReceipts: true,
      includeAccrual: true,
    });

    const result = buildForecast({
      today,
      horizonDays,
      startingBalances,
      events: allEvents,
    });

    const body = ForecastResponseSchema.parse(result);
    res.json(body);
  } catch (error) {
    console.error('[Forecast] GET / error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build forecast: ${message}` });
  }
});

export default router;
