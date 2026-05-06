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
import { recurringKey } from '../../utils/recurring-pipeline.js';
import type { UpcomingRecurringBuckets } from '../../utils/recurring-upcoming.js';
import { buildUpcomingIncomeRecurring } from '../../utils/recurring-upcoming.js';
import {
  collectAccrualEvents,
  collectIncomeRecurringEvents,
  collectInvoiceReceiptEvents,
  collectObligationEvents,
  collectRecurringEvents,
} from './collect-events.js';
import type { ForecastEvent } from './events.js';

/**
 * Stable sandbox / exclusion id for an upcoming recurring row (matches
 * {@link recurringIncomeStableKey} for pipeline {@link RecurringExpense} rows).
 */
export function upcomingRecurringStableKey(item: UpcomingRecurring): string {
  const declared = item.declaredObligationId;
  if (declared !== undefined && declared.length > 0) {
    return `declared:${declared}`;
  }
  return recurringKey({
    merchant: item.merchant,
    category: item.category,
    colour: item.colour,
    amount: item.amount,
    frequency: item.frequency,
    monthsActive: 0,
    annualTotal: 0,
    logoUrl: item.logoUrl,
    sourceAccount: item.sourceAccount,
    billingDayOfMonth: null,
    billingMonth: null,
  });
}

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
  /**
   * When true, adds detected **income** recurring (pipeline monthly/annual
   * income) as positive cash events — used by debt-strategy sandbox scenarios
   * so income toggles affect the merged runway.
   */
  readonly includeDetectedIncomeRecurring?: boolean;
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
    ...(e.declaredObligationId !== undefined
      ? { declaredObligationId: e.declaredObligationId }
      : {}),
  }));
}

function pickMonthlyIncomeRecurringForForecast(
  today: string,
  pipeline: PipelineResult,
  incomeUpcoming: UpcomingRecurringBuckets,
): readonly UpcomingRecurring[] {
  if (incomeUpcoming.thisMonth.length > 0) {
    return incomeUpcoming.thisMonth;
  }
  return pipeline.monthlyIncomeRecurring.map(e => ({
    merchant: e.merchant,
    category: e.category,
    colour: e.colour,
    logoUrl: e.logoUrl,
    amount: e.amount,
    frequency: 'monthly' as const,
    sourceAccount: e.sourceAccount,
    nextExpectedDate: shiftIsoDate(today, 1),
    lastChargeDate: null,
    ...(e.declaredObligationId !== undefined
      ? { declaredObligationId: e.declaredObligationId }
      : {}),
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
    includeDetectedIncomeRecurring,
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

  let incomeRecurringEvents: ForecastEvent[] = [];
  if (includeDetectedIncomeRecurring === true) {
    const incomeBuckets = buildUpcomingIncomeRecurring(
      pipeline,
      new Date(`${today}T00:00:00Z`),
    );
    const incomeMonthlies = applyRecurringFilter(
      pickMonthlyIncomeRecurringForForecast(today, pipeline, incomeBuckets),
      recurringPredicate,
    );
    const incomeAnnuals = applyRecurringFilter(incomeBuckets.thisYear, recurringPredicate);
    incomeRecurringEvents = collectIncomeRecurringEvents({
      monthlyRecurring: incomeMonthlies,
      annualRecurring: incomeAnnuals,
      today,
      horizon,
      currencyByAccount,
    });
  }

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
    ...incomeRecurringEvents,
    ...invoiceEvents,
    ...accrualEvents,
  ].sort((a, b) => a.date.localeCompare(b.date));
}
