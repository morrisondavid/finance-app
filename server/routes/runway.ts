/**
 * GET /api/runway — worst-case household stress (no new contract income) with
 * GBP + AED holistic headlines and entity drill-down in `stress` blocks.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ACCOUNTS,
  EntityIdSchema,
  RunwayResponseSchema,
  type AccountName,
  type CurrencyCode,
  type EntityId,
  type RunwayHouseholdCurrency,
} from '../../shared/api-contracts.js';
import type { ForecastEvent } from '../domain/forecast/events.js';
import { shiftIsoDate, todayIsoLocal } from '../../shared/iso-date.js';
import { isMandatoryCategory } from '../../shared/expenses-insight.js';
import { buildExpensesSheetResponse } from '../../shared/expenses-sheet-build.js';
import { getAllAccountBalances } from '../db/repositories/balance.js';
import { getUpcomingObligations, toApiObligation } from '../db/repositories/obligations.js';
import { runExpensesOverviewPipeline } from '../utils/expenses-overview-pipeline.js';
import { buildUpcomingRecurring } from '../utils/recurring-upcoming.js';
import { buildExpensesSheetInputFromPipeline } from '../utils/expenses-pipeline-to-sheet.js';
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
import { sumCashAndCreditByCurrency } from '../domain/accounts/runway-credit.js';
import {
  assembleForecastEvents,
  buildForecast,
  firstNegativeBalanceDate,
  mergeAccountSeriesByCurrency,
  runwayMonthsToDate,
  type AccountStartingBalance,
} from '../domain/forecast/index.js';
import type { ForecastResult } from '../domain/forecast/build-forecast.js';
import type { AccountBalance } from '../db/repositories/balance.js';

const router = Router();

const QuerySchema = z.object({
  days: z.coerce.number().int().positive().default(720),
  entityId: EntityIdSchema.optional(),
  /** When `accounts`, per-account series are included in `stress` (larger JSON). */
  detail: z.enum(['accounts', 'summary']).default('summary'),
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

const HEADLINE_CURRENCIES: readonly CurrencyCode[] = ['GBP', 'AED'];

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

function filterEventsToAccountSet(
  events: readonly ForecastEvent[],
  allowed: ReadonlySet<AccountName>,
): ForecastEvent[] {
  return events.filter(e => allowed.has(e.account));
}

function buildHouseholdCurrencyBlock(
  currency: CurrencyCode,
  full: ForecastResult,
  mandatory: ForecastResult,
  today: string,
  balances: Record<AccountName, AccountBalance>,
): RunwayHouseholdCurrency {
  const mergedFull = mergeAccountSeriesByCurrency(full.accounts, currency);
  const mergedMan = mergeAccountSeriesByCurrency(mandatory.accounts, currency);
  const fFull = firstNegativeBalanceDate(mergedFull);
  const fMan = firstNegativeBalanceDate(mergedMan);
  const cc = sumCashAndCreditByCurrency(currency, balances);
  return {
    currency,
    runwayMonthsFullRecurring: runwayMonthsToDate(today, fFull),
    runwayMonthsMandatoryRecurring: runwayMonthsToDate(today, fMan),
    firstStressDateFullRecurring: fFull,
    firstStressDateMandatoryRecurring: fMan,
    totalCashCurrent: cc.totalCashCurrent,
    totalAvailableCredit: cc.totalAvailableCredit,
  };
}

router.get('/', (req: Request, res: Response) => {
  try {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }

    const { days: horizonDays, entityId: filterEntityId, detail } = parsed.data;
    const today = todayIsoLocal();
    const horizon = shiftIsoDate(today, horizonDays);

    const currencyByAccount = buildCurrencyByAccount();
    const accountsByEntity = buildAccountsByEntity();

    const allowedAccountSet: Set<AccountName> = (() => {
      if (filterEntityId === undefined) {
        return new Set(ACCOUNTS);
      }
      const names = accountsForEntity(filterEntityId);
      return new Set<AccountName>([...names]);
    })();

    const allBalances = getAllAccountBalances();
    const startingBalances: AccountStartingBalance[] = [];
    for (const name of ACCOUNTS) {
      if (!allowedAccountSet.has(name)) continue;
      const entityId = getEntityIdForAccount(name);
      const bal = allBalances[name];
      const currency = currencyByAccount.get(name);
      if (currency === undefined) continue;
      startingBalances.push({
        account: name,
        balance: bal.currentBalance,
        currency,
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
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const yearEnd = `${Number(today.slice(0, 4)) + 1}-12-31`;
    const publicHolidayDatesByEntity = new Map(
      allEntityIds().map(eid => [eid, holidayDatesForEntity(eid, yearStart, yearEnd)] as const),
    );

    const commonAssemble = {
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
      includeInvoiceReceipts: false,
      includeAccrual: false,
    };

    const eventsFull = filterEventsToAccountSet(
      assembleForecastEvents({ ...commonAssemble, recurringPredicate: undefined }),
      allowedAccountSet,
    );
    const eventsMan = filterEventsToAccountSet(
      assembleForecastEvents({
        ...commonAssemble,
        recurringPredicate: item => isMandatoryCategory(item.category),
      }),
      allowedAccountSet,
    );

    const forecastFull = buildForecast({
      today,
      horizonDays,
      startingBalances,
      events: eventsFull,
    });
    const forecastMan = buildForecast({
      today,
      horizonDays,
      startingBalances,
      events: eventsMan,
    });

    const sheetIn = buildExpensesSheetInputFromPipeline(pipeline);
    const sheet = buildExpensesSheetResponse(sheetIn);

    const household: { GBP?: RunwayHouseholdCurrency; AED?: RunwayHouseholdCurrency } = {};
    for (const c of HEADLINE_CURRENCIES) {
      const hasAny = ACCOUNTS.some(n => allowedAccountSet.has(n) && getAccountConfig(n).currency === c);
      if (!hasAny) continue;
      const block = buildHouseholdCurrencyBlock(c, forecastFull, forecastMan, today, allBalances);
      if (c === 'GBP') household.GBP = block;
      if (c === 'AED') household.AED = block;
    }

    const scopeNote =
      filterEntityId === undefined
        ? 'Insight uses rolling UK-centric recurring detection; bills vs QoL split is strongest for GBP/personal lines. Holistic runways merge all accounts in each currency.'
        : `Insight uses rolling UK-centric recurring detection. Runway is scoped to entity ${filterEntityId} accounts only.`;

    const body = RunwayResponseSchema.parse({
      today,
      horizonDays,
      household,
      insight: sheet.insight,
      insightNote: scopeNote,
      stress: {
        fullRecurring: {
          entities: forecastFull.entities,
          accounts: detail === 'accounts' ? forecastFull.accounts : undefined,
        },
        mandatoryRecurring: {
          entities: forecastMan.entities,
          accounts: detail === 'accounts' ? forecastMan.accounts : undefined,
        },
      },
    });
    res.json(body);
  } catch (error) {
    console.error('[Runway] GET / error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build runway: ${message}` });
  }
});

export default router;
