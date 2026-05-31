/**
 * Canonical forecast-input loader.
 *
 * Three callers needed the same loader sequence and were each
 * maintaining their own copy:
 *
 *   - `/api/forecast` route        — `server/routes/forecast.ts` lines 80-138
 *   - `assembleRunway`             — `server/domain/forecast/assemble-runway.ts` lines 143-198
 *   - § 1.9 Debt Strategy planner  — was about to be a fourth copy
 *
 * All three load `getAllAccountBalances`, `getUpcomingObligations`,
 * `runExpensesOverviewPipeline`, `buildUpcomingRecurring`,
 * `listInvoicesByStatus('issued')`, `listActiveContracts`, `allLeave`
 * + the same three lookup maps (`currencyByAccount`,
 * `accountsByEntity`, `defaultAccountByType`). They differ only in
 * which `assembleForecastEvents` flags they pass downstream, so the
 * loader is a clean extraction point.
 *
 * `loadForecastInputs(opts)` is the single entrypoint. Any future
 * caller asking "what do I need to project the forecast forward?"
 * uses this — see `projectIncomeForWindow` (sibling module) for the
 * canonical "income across these dates" primitive built on top.
 */

import { shiftIsoDate, todayIsoLocal } from '../../../shared/iso-date.js';
import {
  ACCOUNTS,
  type AccountName,
  type Contract,
  type CurrencyCode,
  type EntityId,
  type Invoice,
  type LeaveRow,
  type ObligationRow,
} from '../../../shared/api-contracts.js';
import { allEntityIds } from '../company/index.js';
import {
  accountsForEntity,
  getAccountConfig,
  getEntityIdForAccount,
} from '../accounts/queries.js';
import { getAllAccountBalances } from '../../db/repositories/balance.js';
import { getUpcomingObligations, toApiObligation } from '../../db/repositories/obligations.js';
import { runExpensesOverviewPipeline } from '../../utils/expenses-overview-pipeline.js';
import { buildUpcomingRecurring, type UpcomingRecurringBuckets } from '../../utils/recurring-upcoming.js';
import type { PipelineResult } from '../../utils/recurring-pipeline.js';
import { listInvoicesByStatus } from '../invoices/index.js';
import { listActiveContracts } from '../contracts/queries.js';
import { allLeave } from '../leave/index.js';
import { holidayDatesForEntity } from '../working-days/public-holidays.js';
import type { AccountStartingBalance } from './build-forecast.js';

/**
 * Default account routing for obligations that don't carry an
 * explicit `account`. Lives here so every forecast caller picks up
 * the same defaults; `assembleRunway` and the forecast route used to
 * each define their own copy.
 */
export const DEFAULT_OBLIGATION_ACCOUNTS: ReadonlyMap<string, AccountName> = new Map([
  ['vat', 'barclays-current'],
  ['corporation-tax', 'barclays-current'],
  ['self-assessment', 'natwest'],
  ['tax-manual', 'barclays-current'],
  ['insurance', 'barclays-current'],
  ['subscription', 'barclays-current'],
  ['other', 'barclays-current'],
]);

/** Default forecast horizon when callers don't specify. */
export const DEFAULT_FORECAST_HORIZON_DAYS = 720;

export interface LoadForecastInputsOpts {
  /** ISO date `YYYY-MM-DD`. Defaults to `todayIsoLocal()`. */
  readonly today?: string;
  /** Forecast horizon in days. Defaults to {@link DEFAULT_FORECAST_HORIZON_DAYS}. */
  readonly horizonDays?: number;
  /**
   * Optional entity filter. When set, `startingBalances` is restricted
   * to accounts owned by `filterEntityId`. The other fields are
   * unfiltered — downstream callers do their own event-set filtering
   * via `filterEventsToAccountSet` (the runway pattern).
   */
  readonly filterEntityId?: EntityId;
  /** When supplied, skips loading (shared composite / survival reads). */
  readonly forecastInputs?: LoadedForecastInputs;
  /** When true, accrual receipts span monthly through contract end. Default false. */
  readonly projectToContractEnd?: boolean;
}

export interface LoadedForecastInputs {
  readonly today: string;
  readonly horizon: string;
  readonly horizonDays: number;
  readonly startingBalances: readonly AccountStartingBalance[];
  readonly obligations: readonly ObligationRow[];
  readonly pipeline: PipelineResult;
  readonly upcomingBuckets: UpcomingRecurringBuckets;
  readonly unpaidInvoices: readonly Invoice[];
  readonly contracts: readonly Contract[];
  readonly leaveRows: readonly LeaveRow[];
  readonly publicHolidayDatesByEntity: ReadonlyMap<EntityId, ReadonlySet<string>>;
  readonly currencyByAccount: ReadonlyMap<AccountName, CurrencyCode>;
  readonly accountsByEntity: ReadonlyMap<EntityId, readonly AccountName[]>;
  readonly defaultAccountByType: ReadonlyMap<string, AccountName>;
  /**
   * Allowed account set when `filterEntityId` is supplied; otherwise
   * the full `ACCOUNTS` set. Exposed so callers can reuse the same
   * filter when winnowing event arrays.
   */
  readonly allowedAccountSet: ReadonlySet<AccountName>;
}

function buildCurrencyByAccount(): Map<AccountName, CurrencyCode> {
  const map = new Map<AccountName, CurrencyCode>();
  for (const name of ACCOUNTS) {
    map.set(name, getAccountConfig(name).currency);
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

export function loadForecastInputs(opts: LoadForecastInputsOpts = {}): LoadedForecastInputs {
  const today = opts.today ?? todayIsoLocal();
  const horizonDays = opts.horizonDays ?? DEFAULT_FORECAST_HORIZON_DAYS;
  const horizon = shiftIsoDate(today, horizonDays);

  const currencyByAccount = buildCurrencyByAccount();
  const accountsByEntity = buildAccountsByEntity();

  const allowedAccountSet: Set<AccountName> = (() => {
    if (opts.filterEntityId === undefined) return new Set(ACCOUNTS);
    return new Set<AccountName>([...accountsForEntity(opts.filterEntityId)]);
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

  // Public holidays for the calendar year of `today` and the year
  // after — covers the longest typical horizon (720d) without
  // pre-loading the universe.
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const yearEnd = `${Number(today.slice(0, 4)) + 1}-12-31`;
  const publicHolidayDatesByEntity = new Map(
    allEntityIds().map(
      eid => [eid, holidayDatesForEntity(eid, yearStart, yearEnd)] as const,
    ),
  );

  return {
    today,
    horizon,
    horizonDays,
    startingBalances,
    obligations,
    pipeline,
    upcomingBuckets,
    unpaidInvoices,
    contracts,
    leaveRows,
    publicHolidayDatesByEntity,
    currencyByAccount,
    accountsByEntity,
    defaultAccountByType: DEFAULT_OBLIGATION_ACCOUNTS,
    allowedAccountSet,
  };
}
