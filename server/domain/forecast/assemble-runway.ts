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
import type { AccountBalance } from '../../db/repositories/balance.js';
import { getAllAccountBalances } from '../../db/repositories/balance.js';
import { getAccountConfig } from '../accounts/queries.js';
import { sumCashAndCreditByCurrency } from '../accounts/runway-credit.js';
import { loadForecastInputs } from './load-inputs.js';
import {
  assembleForecastEvents,
  buildForecast,
  firstNegativeBalanceDate,
  mergeAccountSeriesByCurrency,
  runwayMonthsToDate,
} from './index.js';
import type { ForecastDailyPoint, ForecastResult } from './build-forecast.js';
import type { ForecastEvent } from './events.js';

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
  const inputs = loadForecastInputs({ horizonDays, filterEntityId: input.filterEntityId });
  const { today, allowedAccountSet, startingBalances } = inputs;

  // Re-fetch the full balances map for `buildHouseholdCurrencyBlock`'s
  // cash + available-credit aggregator (it needs every account, not
  // just those in `startingBalances`).
  const allBalances = getAllAccountBalances();

  const commonAssemble = {
    today: inputs.today,
    horizon: inputs.horizon,
    defaultAccountByType: inputs.defaultAccountByType,
    currencyByAccount: inputs.currencyByAccount,
    accountsByEntity: inputs.accountsByEntity,
    obligations: inputs.obligations,
    pipeline: inputs.pipeline,
    upcomingBuckets: inputs.upcomingBuckets,
    unpaidInvoices: inputs.unpaidInvoices,
    contracts: inputs.contracts,
    leaveRows: inputs.leaveRows,
    publicHolidayDatesByEntity: inputs.publicHolidayDatesByEntity,
    // Runway is the "lose all contracts" stress scenario — both off.
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
