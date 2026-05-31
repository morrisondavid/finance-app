/**
 * Forecast event collectors — convert existing domain data into the
 * uniform {@link ForecastEvent} shape consumed by the timeline walker.
 *
 * Four collectors, one per data source:
 *   1. Obligations (tax + manual)
 *   2. Recurring expenses (monthly + annual, repeated through horizon)
 *   3. Invoice receipts (unpaid issued invoices)
 *   4. Accrued contract income (not yet invoiced)
 *
 * Pure: every function takes explicit inputs and returns events.
 */

import type {
  AccountName,
  Contract,
  CurrencyCode,
  EntityId,
  Invoice,
  ObligationRow,
  UpcomingRecurring,
} from '../../../shared/api-contracts.js';
import { shiftIsoDate, monthRange } from '../../../shared/iso-date.js';
import { calculateWorkload } from '../contracts/workload.js';
import type { ForecastEvent } from './events.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the primary business current account for an entity. Used as
 * the default destination when a data source doesn't specify an account.
 */
export function primaryAccountForEntity(
  entityId: EntityId,
  accountsByEntity: ReadonlyMap<EntityId, readonly AccountName[]>,
): AccountName | null {
  const accounts = accountsByEntity.get(entityId);
  if (!accounts || accounts.length === 0) return null;
  return accounts[0];
}

function accountCurrency(
  account: AccountName,
  currencyByAccount: ReadonlyMap<AccountName, CurrencyCode>,
): CurrencyCode {
  return currencyByAccount.get(account) ?? 'GBP';
}

// ─── 1. Obligations ──────────────────────────────────────────────────────────

export interface CollectObligationEventsInput {
  readonly obligations: readonly ObligationRow[];
  readonly defaultAccountByType: ReadonlyMap<string, AccountName>;
  readonly currencyByAccount: ReadonlyMap<AccountName, CurrencyCode>;
  readonly horizon: string;
}

export function collectObligationEvents(
  input: CollectObligationEventsInput,
): ForecastEvent[] {
  const { obligations, defaultAccountByType, currencyByAccount, horizon } = input;
  const events: ForecastEvent[] = [];

  for (const ob of obligations) {
    if (!ob.dueDate || ob.dueDate > horizon) continue;
    if (ob.expectedAmount === null || ob.expectedAmount === 0) continue;

    const account = (ob.paidFromAccount as AccountName | null)
      ?? defaultAccountByType.get(ob.type)
      ?? null;
    if (!account) continue;

    events.push({
      date: ob.dueDate,
      amount: -Math.abs(ob.expectedAmount),
      account,
      currency: accountCurrency(account, currencyByAccount),
      source: 'obligation',
      label: ob.name,
      obligationId: ob.id,
    });
  }
  return events;
}

// ─── 2. Recurring ────────────────────────────────────────────────────────────

export interface CollectRecurringEventsInput {
  readonly monthlyRecurring: readonly UpcomingRecurring[];
  readonly annualRecurring: readonly UpcomingRecurring[];
  readonly today: string;
  readonly horizon: string;
  readonly currencyByAccount: ReadonlyMap<AccountName, CurrencyCode>;
}

/**
 * Advance a billing-day-of-month by N calendar months. Clamps to the
 * last day of the target month when the billing day exceeds its length.
 */
function advanceMonth(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return target.toISOString().slice(0, 8) + String(day).padStart(2, '0');
}

export function collectRecurringEvents(
  input: CollectRecurringEventsInput,
): ForecastEvent[] {
  const { monthlyRecurring, annualRecurring, today, horizon, currencyByAccount } = input;
  const events: ForecastEvent[] = [];

  for (const item of monthlyRecurring) {
    let nextDate = item.nextExpectedDate;
    if (!nextDate || nextDate < today) continue;
    while (nextDate <= horizon) {
      events.push({
        date: nextDate,
        amount: -Math.abs(item.amount),
        account: item.sourceAccount as AccountName,
        currency: accountCurrency(item.sourceAccount as AccountName, currencyByAccount),
        source: 'recurring',
        label: item.merchant,
      });
      nextDate = advanceMonth(nextDate, 1);
    }
  }

  for (const item of annualRecurring) {
    if (!item.nextExpectedDate || item.nextExpectedDate > horizon) continue;
    if (item.nextExpectedDate < today) continue;
    events.push({
      date: item.nextExpectedDate,
      amount: -Math.abs(item.amount),
      account: item.sourceAccount as AccountName,
      currency: accountCurrency(item.sourceAccount as AccountName, currencyByAccount),
      source: 'recurring',
      label: item.merchant,
    });
  }

  return events;
}

/** Monthly / annual **income** inflows (positive amounts), same schedule shape as expenses. */
export function collectIncomeRecurringEvents(
  input: CollectRecurringEventsInput,
): ForecastEvent[] {
  const { monthlyRecurring, annualRecurring, today, horizon, currencyByAccount } = input;
  const events: ForecastEvent[] = [];

  for (const item of monthlyRecurring) {
    let nextDate = item.nextExpectedDate;
    if (!nextDate || nextDate < today) continue;
    while (nextDate <= horizon) {
      events.push({
        date: nextDate,
        amount: Math.abs(item.amount),
        account: item.sourceAccount as AccountName,
        currency: accountCurrency(item.sourceAccount as AccountName, currencyByAccount),
        source: 'recurring',
        label: item.merchant,
      });
      nextDate = advanceMonth(nextDate, 1);
    }
  }

  for (const item of annualRecurring) {
    if (!item.nextExpectedDate || item.nextExpectedDate > horizon) continue;
    if (item.nextExpectedDate < today) continue;
    events.push({
      date: item.nextExpectedDate,
      amount: Math.abs(item.amount),
      account: item.sourceAccount as AccountName,
      currency: accountCurrency(item.sourceAccount as AccountName, currencyByAccount),
      source: 'recurring',
      label: item.merchant,
    });
  }

  return events;
}

// ─── 3. Invoice receipts ─────────────────────────────────────────────────────

export interface CollectInvoiceReceiptEventsInput {
  readonly unpaidInvoices: readonly Invoice[];
  readonly today: string;
  readonly horizon: string;
  readonly accountsByEntity: ReadonlyMap<EntityId, readonly AccountName[]>;
  readonly currencyByAccount: ReadonlyMap<AccountName, CurrencyCode>;
}

export function collectInvoiceReceiptEvents(
  input: CollectInvoiceReceiptEventsInput,
): ForecastEvent[] {
  const { unpaidInvoices, today, horizon, accountsByEntity, currencyByAccount } = input;
  const events: ForecastEvent[] = [];

  for (const inv of unpaidInvoices) {
    const account = primaryAccountForEntity(inv.issuing_entity_id, accountsByEntity);
    if (!account) continue;

    const receiptDate = inv.due_date < today
      ? shiftIsoDate(today, 1)
      : inv.due_date;
    if (receiptDate > horizon) continue;

    events.push({
      date: receiptDate,
      amount: inv.total,
      account,
      currency: accountCurrency(account, currencyByAccount),
      source: 'invoice-receipt',
      label: `Invoice ${inv.id}`,
    });
  }
  return events;
}

// ─── 4. Accrual (not yet invoiced) ──────────────────────────────────────────

export interface CollectAccrualEventsInput {
  readonly contracts: readonly Contract[];
  readonly leaveRows: readonly import('../../../shared/api-contracts.js').LeaveRow[];
  readonly publicHolidayDatesByEntity: ReadonlyMap<EntityId, ReadonlySet<string>>;
  readonly today: string;
  readonly horizon: string;
  /** When true, emit one accrual per month through contract end (survival / future income). Default false. */
  readonly projectToContractEnd?: boolean;
  readonly accountsByEntity: ReadonlyMap<EntityId, readonly AccountName[]>;
  readonly currencyByAccount: ReadonlyMap<AccountName, CurrencyCode>;
  readonly invoicedContractIds: ReadonlySet<string>;
}

function minIsoDate(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxIsoDate(a: string, b: string): string {
  return a >= b ? a : b;
}

function tryEmitAccrualForWindow(
  contract: Contract,
  periodStart: string,
  periodEnd: string,
  arrivalMonthEnd: string,
  leaveRows: readonly import('../../../shared/api-contracts.js').LeaveRow[],
  publicHolidayDatesByEntity: ReadonlyMap<EntityId, ReadonlySet<string>>,
  horizon: string,
  account: AccountName,
  currencyByAccount: ReadonlyMap<AccountName, CurrencyCode>,
): ForecastEvent | null {
  if (periodStart > periodEnd) return null;

  const publicHolidayDates = publicHolidayDatesByEntity.get(contract.issuing_entity_id);
  const workload = calculateWorkload({
    contract,
    leaveRows,
    start: periodStart,
    end: periodEnd,
    publicHolidayDates,
  });

  if (workload.subtotal <= 0) return null;

  const arrivalDate = contract.invoice_cadence === 'weekly'
    ? shiftIsoDate(periodEnd, contract.payment_terms_days + 7)
    : shiftIsoDate(arrivalMonthEnd, contract.payment_terms_days);

  if (arrivalDate > horizon) return null;

  return {
    date: arrivalDate,
    amount: workload.subtotal,
    account,
    currency: accountCurrency(account, currencyByAccount),
    source: 'accrual',
    label: `Accrual ${contract.id}`,
    contractId: contract.id,
  };
}

export function collectAccrualEvents(
  input: CollectAccrualEventsInput,
): ForecastEvent[] {
  const {
    contracts, leaveRows, publicHolidayDatesByEntity,
    today, horizon, accountsByEntity, currencyByAccount,
    invoicedContractIds, projectToContractEnd,
  } = input;
  const events: ForecastEvent[] = [];

  for (const contract of contracts) {
    if (!contract.active) continue;
    if (invoicedContractIds.has(contract.id)) continue;

    const account = primaryAccountForEntity(contract.issuing_entity_id, accountsByEntity);
    if (!account) continue;

    if (projectToContractEnd !== true) {
      const { end: monthEnd } = monthRange(today);
      const periodEnd = contract.end_date !== null && contract.end_date < monthEnd
        ? contract.end_date : monthEnd;
      const periodStart = maxIsoDate(today, contract.start_date);
      const ev = tryEmitAccrualForWindow(
        contract,
        periodStart,
        periodEnd,
        monthEnd,
        leaveRows,
        publicHolidayDatesByEntity,
        horizon,
        account,
        currencyByAccount,
      );
      if (ev) events.push(ev);
      continue;
    }

    const contractEndLimit = contract.end_date ?? horizon;
    let cursor = today;
    while (cursor <= horizon && cursor <= contractEndLimit) {
      const { start: monthStart, end: monthEnd } = monthRange(cursor);
      const periodStart = maxIsoDate(maxIsoDate(monthStart, today), contract.start_date);
      const periodEnd = minIsoDate(monthEnd, contractEndLimit);
      const ev = tryEmitAccrualForWindow(
        contract,
        periodStart,
        periodEnd,
        monthEnd,
        leaveRows,
        publicHolidayDatesByEntity,
        horizon,
        account,
        currencyByAccount,
      );
      if (ev) events.push(ev);
      const nextMonthFirst = shiftIsoDate(monthEnd, 1);
      if (nextMonthFirst <= cursor) break;
      cursor = nextMonthFirst;
    }
  }

  return events;
}
