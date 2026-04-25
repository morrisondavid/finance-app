/**
 * DRY assembly of all {@link ForecastEvent}s for forecast and runway routes.
 * Pure: callers supply already-loaded data; no I/O.
 */

import { shiftIsoDate } from '../../../shared/iso-date.js';
import type {
  AccountName,
  Contract,
  CurrencyCode,
  EntityId,
  Invoice,
  ObligationRow,
  UpcomingRecurring,
} from '../../../shared/api-contracts.js';
import type { PipelineResult } from '../../utils/recurring-pipeline.js';
import type { UpcomingRecurringBuckets } from '../../utils/recurring-upcoming.js';
import {
  collectAccrualEvents,
  collectInvoiceReceiptEvents,
  collectObligationEvents,
  collectRecurringEvents,
} from './collect-events.js';
import type { ForecastEvent } from './events.js';

export interface AssembleForecastEventsParams {
  readonly today: string;
  readonly horizon: string;
  readonly defaultAccountByType: ReadonlyMap<string, AccountName>;
  readonly currencyByAccount: ReadonlyMap<AccountName, CurrencyCode>;
  readonly accountsByEntity: ReadonlyMap<EntityId, readonly AccountName[]>;
  readonly obligations: readonly ObligationRow[];
  /** Raw pipeline result — used if {@link pickMonthlyRecurringForForecast} needs fallback rows. */
  readonly pipeline: PipelineResult;
  /** From {@link buildUpcomingRecurring}. */
  readonly upcomingBuckets: UpcomingRecurringBuckets;
  readonly unpaidInvoices: readonly Invoice[];
  readonly contracts: readonly Contract[];
  readonly leaveRows: readonly import('../../../shared/api-contracts.js').LeaveRow[];
  readonly publicHolidayDatesByEntity: ReadonlyMap<EntityId, ReadonlySet<string>>;
  readonly includeInvoiceReceipts: boolean;
  readonly includeAccrual: boolean;
  /** When set, only recurring events whose `UpcomingRecurring` passes are included. */
  readonly recurringPredicate?: (item: UpcomingRecurring) => boolean;
}

/**
 * If the upcoming bucket is empty, mirror the forecast route: synthesize
 * {@link UpcomingRecurring} rows from the detector’s `monthlyExpenseRecurring`
 * with a placeholder next date.
 */
export function pickMonthlyRecurringForForecast(
  today: string,
  pipeline: PipelineResult,
  upcoming: UpcomingRecurringBuckets,
): readonly UpcomingRecurring[] {
  if (upcoming.thisMonth.length > 0) {
    return upcoming.thisMonth;
  }
  return pipeline.monthlyExpenseRecurring.map(e => ({
    merchant: e.merchant,
    category: e.category,
    colour: e.colour,
    logoUrl: e.logoUrl,
    amount: e.amount,
    frequency: 'monthly' as const,
    sourceAccount: e.sourceAccount,
    nextExpectedDate: shiftIsoDate(today, 1),
    lastChargeDate: null,
  }));
}

function applyRecurringFilter(
  items: readonly UpcomingRecurring[],
  recurringPredicate: ((item: UpcomingRecurring) => boolean) | undefined,
): UpcomingRecurring[] {
  if (recurringPredicate === undefined) {
    return [...items];
  }
  return items.filter(recurringPredicate);
}

export function assembleForecastEvents(params: AssembleForecastEventsParams): ForecastEvent[] {
  const {
    today,
    horizon,
    defaultAccountByType,
    currencyByAccount,
    accountsByEntity,
    obligations,
    pipeline,
    upcomingBuckets,
    unpaidInvoices,
    contracts,
    leaveRows,
    publicHolidayDatesByEntity,
    includeInvoiceReceipts,
    includeAccrual,
    recurringPredicate,
  } = params;

  const obligationEvents = collectObligationEvents({
    obligations,
    defaultAccountByType,
    currencyByAccount,
    horizon,
  });

  const monthlies = applyRecurringFilter(
    pickMonthlyRecurringForForecast(today, pipeline, upcomingBuckets),
    recurringPredicate,
  );
  const annuals = applyRecurringFilter(upcomingBuckets.thisYear, recurringPredicate);

  const recurringEvents = collectRecurringEvents({
    monthlyRecurring: monthlies,
    annualRecurring: annuals,
    today,
    horizon,
    currencyByAccount,
  });

  const invoiceEvents = includeInvoiceReceipts
    ? collectInvoiceReceiptEvents({
        unpaidInvoices,
        today,
        horizon,
        accountsByEntity,
        currencyByAccount,
      })
    : [];

  const invoicedContractIds = new Set(
    unpaidInvoices.map(inv => inv.contract_id),
  );

  const accrualEvents = includeAccrual
    ? collectAccrualEvents({
        contracts,
        leaveRows,
        publicHolidayDatesByEntity,
        today,
        horizon,
        accountsByEntity,
        currencyByAccount,
        invoicedContractIds,
      })
    : [];

  return [
    ...obligationEvents,
    ...recurringEvents,
    ...invoiceEvents,
    ...accrualEvents,
  ].sort((a, b) => a.date.localeCompare(b.date));
}
