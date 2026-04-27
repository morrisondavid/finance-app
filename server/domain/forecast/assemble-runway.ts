/**
 * I/O orchestration for §1.6's runway calculation. Loads from balances /
 * obligations / contracts / invoices / leave / public-holidays / pipeline
 * registries; runs through the pure forecast engine + per-currency
 * household block; returns one bundle.
 *
 * Two consumers:
 *   - [`server/routes/runway.ts`](../../routes/runway.ts) — wraps the
 *     bundle into the API response with optional `?detail=accounts`.
 *   - [`server/domain/warnings/runway-thresholds.ts`](../warnings/runway-thresholds.ts) — applies threshold bands to the
 *     household block + per-currency merged series and emits §1.8
 *     warnings.
 *
 * Pure computation lives in {@link assembleForecastEvents},
 * {@link buildForecast}, {@link mergeAccountSeriesByCurrency},
 * {@link firstNegativeBalanceDate}, {@link runwayMonthsToDate},
 * {@link sumCashAndCreditByCurrency}. Nothing is recomputed here.
 */

import {
  ACCOUNTS,
  type AccountName,
  type CurrencyCode,
  type EntityId,
  type RunwayHouseholdCurrency,
} from '../../../shared/api-contracts.js';
import { isMandatoryCategory } from '../../../shared/expenses-insight.js';
import { shiftIsoDate, todayIsoLocal } from '../../../shared/iso-date.js';
import type { AccountBalance } from '../../db/repositories/balance.js';
import { getAllAccountBalances } from '../../db/repositories/balance.js';
import { getUpcomingObligations, toApiObligation } from '../../db/repositories/obligations.js';
import { runExpensesOverviewPipeline } from '../../utils/expenses-overview-pipeline.js';
import { buildUpcomingRecurring } from '../../utils/recurring-upcoming.js';
import { listInvoicesByStatus } from '../invoices/index.js';
import { listActiveContracts } from '../contracts/queries.js';
import { allLeave } from '../leave/index.js';
import { holidayDatesForEntity } from '../working-days/public-holidays.js';
import {
  accountsForEntity,
  getAccountConfig,
  getEntityIdForAccount,
} from '../accounts/queries.js';
import { allEntityIds } from '../company/index.js';
import { sumCashAndCreditByCurrency } from '../accounts/runway-credit.js';
import {
  assembleForecastEvents,
  buildForecast,
  firstNegativeBalanceDate,
  mergeAccountSeriesByCurrency,
  runwayMonthsToDate,
  type AccountStartingBalance,
} from './index.js';
import type { ForecastDailyPoint, ForecastResult } from './build-forecast.js';
import type { ForecastEvent } from './events.js';

const DEFAULT_OBLIGATION_ACCOUNTS = new Map<string, AccountName>([
  ['vat', 'barclays-current'],
  ['corporation-tax', 'barclays-current'],
  ['self-assessment', 'natwest'],
  ['tax-manual', 'barclays-current'],
  ['insurance', 'barclays-current'],
  ['subscription', 'barclays-current'],
  ['other', 'barclays-current'],
]);

export const RUNWAY_HEADLINE_CURRENCIES: readonly CurrencyCode[] = ['GBP', 'AED'];

export interface AssembleRunwayInput {
  /** Forecast horizon in days. Defaults to 720 (matches the API default). */
  readonly horizonDays?: number;
  /** Optional entity filter; restricts the calculation to that entity's accounts. */
  readonly filterEntityId?: EntityId;
}

export interface AssembledRunway {
  readonly today: string;
  readonly horizonDays: number;
  /** Per-currency household block (same shape served by `/api/runway`). */
  readonly household: { GBP?: RunwayHouseholdCurrency; AED?: RunwayHouseholdCurrency };
  /** Full-recurring stress: forecast result + per-currency merged daily series. */
  readonly fullRecurring: {
    readonly result: ForecastResult;
    readonly mergedByCurrency: ReadonlyMap<CurrencyCode, ForecastDailyPoint[]>;
  };
  /** Mandatory-only stress: same shape. */
  readonly mandatoryRecurring: {
    readonly result: ForecastResult;
    readonly mergedByCurrency: ReadonlyMap<CurrencyCode, ForecastDailyPoint[]>;
  };
}

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

export function assembleRunway(input: AssembleRunwayInput = {}): AssembledRunway {
  const horizonDays = input.horizonDays ?? 720;
  const filterEntityId = input.filterEntityId;

  const today = todayIsoLocal();
  const horizon = shiftIsoDate(today, horizonDays);

  const currencyByAccount = buildCurrencyByAccount();
  const accountsByEntity = buildAccountsByEntity();

  const allowedAccountSet: Set<AccountName> = (() => {
    if (filterEntityId === undefined) return new Set(ACCOUNTS);
    return new Set<AccountName>([...accountsForEntity(filterEntityId)]);
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

  const household: { GBP?: RunwayHouseholdCurrency; AED?: RunwayHouseholdCurrency } = {};
  const mergedFullByCurrency = new Map<CurrencyCode, ForecastDailyPoint[]>();
  const mergedManByCurrency = new Map<CurrencyCode, ForecastDailyPoint[]>();
  for (const c of RUNWAY_HEADLINE_CURRENCIES) {
    const hasAny = ACCOUNTS.some(n => allowedAccountSet.has(n) && getAccountConfig(n).currency === c);
    if (!hasAny) continue;
    const block = buildHouseholdCurrencyBlock(c, forecastFull, forecastMan, today, allBalances);
    if (c === 'GBP') household.GBP = block;
    if (c === 'AED') household.AED = block;
    mergedFullByCurrency.set(c, mergeAccountSeriesByCurrency(forecastFull.accounts, c));
    mergedManByCurrency.set(c, mergeAccountSeriesByCurrency(forecastMan.accounts, c));
  }

  return {
    today,
    horizonDays,
    household,
    fullRecurring: { result: forecastFull, mergedByCurrency: mergedFullByCurrency },
    mandatoryRecurring: { result: forecastMan, mergedByCurrency: mergedManByCurrency },
  };
}
