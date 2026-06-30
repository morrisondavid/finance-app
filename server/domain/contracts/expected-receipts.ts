/**
 * Expected receipts — contract accrual, unpaid issued invoices, and
 * declared rental income. Delegates to the forecast collectors so
 * amounts/dates match the runway inputs (single source of truth).
 */

import type {
  AccountName,
  Contract,
  CurrencyCode,
  EntityId,
  ExpectedReceiptRow,
  ExpectedReceiptsResponse,
  Invoice,
  LeaveRow,
  RecurringExpense,
} from '../../../shared/api-contracts.js';
import { pickMonthlyIncomeRecurringForForecast } from '../forecast/assemble-forecast-events.js';
import {
  collectAccrualEvents,
  collectIncomeRecurringEvents,
  collectInvoiceReceiptEvents,
} from '../forecast/collect-events.js';
import type { ForecastEvent } from '../forecast/events.js';
import type { LoadedForecastInputs, LoadForecastInputsOpts } from '../forecast/load-inputs.js';
import { loadForecastInputs } from '../forecast/load-inputs.js';
import { selectDeclaredRentalIncomeRows } from '../obligations/rental-income.js';
import type { PipelineResult } from '../../utils/recurring-pipeline.js';
import { buildUpcomingIncomeRecurring } from '../../utils/recurring-upcoming.js';

export interface ComposeExpectedReceiptsInput {
  readonly asOf: string;
  readonly horizon: string;
  readonly contracts: readonly Contract[];
  readonly leaveRows: readonly LeaveRow[];
  readonly publicHolidayDatesByEntity: ReadonlyMap<EntityId, ReadonlySet<string>>;
  readonly unpaidInvoices: readonly Invoice[];
  readonly accountsByEntity: ReadonlyMap<EntityId, readonly AccountName[]>;
  readonly currencyByAccount: ReadonlyMap<AccountName, CurrencyCode>;
  readonly allowedAccountSet: ReadonlySet<AccountName>;
  /** When true, accrual receipts span monthly through contract end. Default false. */
  readonly projectToContractEnd?: boolean;
  /** Per-contract owed-window start, so trailing unpaid work is projected. */
  readonly accrualWindowStartByContractId?: ReadonlyMap<string, string>;
  /** Recurring pipeline — required when projecting declared rental income. */
  readonly pipeline?: PipelineResult;
  /** Declared rental rows from {@link selectDeclaredRentalIncomeRows}. */
  readonly rentalIncomeRecurring?: readonly RecurringExpense[];
}

function compareReceiptRows(a: ExpectedReceiptRow, b: ExpectedReceiptRow): number {
  const c = a.expectedDate.localeCompare(b.expectedDate);
  if (c !== 0) return c;
  return `${a.source}|${a.contractId ?? ''}|${a.invoiceId ?? ''}|${a.obligationId ?? ''}`.localeCompare(
    `${b.source}|${b.contractId ?? ''}|${b.invoiceId ?? ''}|${b.obligationId ?? ''}`,
  );
}

function rentalIncomeReceiptRows(input: {
  readonly pipeline: PipelineResult;
  readonly rentalIncomeRecurring: readonly RecurringExpense[];
  readonly asOf: string;
  readonly horizon: string;
  readonly currencyByAccount: ReadonlyMap<AccountName, CurrencyCode>;
  readonly allowedAccountSet: ReadonlySet<AccountName>;
}): ExpectedReceiptRow[] {
  if (input.rentalIncomeRecurring.length === 0) {
    return [];
  }

  const rentalPipeline: PipelineResult = {
    ...input.pipeline,
    monthlyIncomeRecurring: [...input.rentalIncomeRecurring],
    annualIncomeRecurring: [],
  };

  const incomeBuckets = buildUpcomingIncomeRecurring(
    rentalPipeline,
    new Date(`${input.asOf}T00:00:00Z`),
  );
  const monthlies = pickMonthlyIncomeRecurringForForecast(
    input.asOf,
    rentalPipeline,
    incomeBuckets,
  );
  const events = collectIncomeRecurringEvents({
    monthlyRecurring: monthlies,
    annualRecurring: [],
    today: input.asOf,
    horizon: input.horizon,
    currencyByAccount: input.currencyByAccount,
  });

  const rows: ExpectedReceiptRow[] = [];
  for (const e of events) {
    if (!input.allowedAccountSet.has(e.account)) continue;
    rows.push({
      expectedDate: e.date,
      amount: e.amount,
      currency: e.currency,
      account: e.account,
      source: 'rental-income',
      contractId: null,
      invoiceId: null,
      obligationId: e.obligationId ?? null,
    });
  }
  return rows;
}

/**
 * Pure composition over forecast inputs already loaded for a horizon.
 * Filters each synthetic receipt to `allowedAccountSet` so entity-scoped
 * queries match the runway pattern.
 */
export function composeExpectedReceipts(input: ComposeExpectedReceiptsInput): ExpectedReceiptsResponse {
  const {
    asOf,
    horizon,
    contracts,
    leaveRows,
    publicHolidayDatesByEntity,
    unpaidInvoices,
    accountsByEntity,
    currencyByAccount,
    allowedAccountSet,
    projectToContractEnd,
    accrualWindowStartByContractId,
    pipeline,
    rentalIncomeRecurring,
  } = input;

  const accrualEvents = collectAccrualEvents({
    contracts,
    leaveRows,
    publicHolidayDatesByEntity,
    today: asOf,
    horizon,
    accountsByEntity,
    currencyByAccount,
    projectToContractEnd,
    accrualWindowStartByContractId,
  });

  const invoiceEvents = collectInvoiceReceiptEvents({
    unpaidInvoices,
    today: asOf,
    horizon,
    accountsByEntity,
    currencyByAccount,
  });

  const invoiceByLabel = new Map<string, Invoice>();
  for (const inv of unpaidInvoices) {
    invoiceByLabel.set(`Invoice ${inv.id}`, inv);
  }

  const receipts: ExpectedReceiptsResponse['receipts'] = [];

  for (const e of invoiceEvents) {
    if (!allowedAccountSet.has(e.account)) continue;
    const inv = invoiceByLabel.get(e.label);
    receipts.push({
      expectedDate: e.date,
      amount: e.amount,
      currency: e.currency,
      account: e.account,
      source: 'invoice-receipt',
      contractId: inv?.contract_id ?? null,
      invoiceId: inv?.id ?? null,
      obligationId: null,
    });
  }

  for (const e of accrualEvents) {
    if (!allowedAccountSet.has(e.account)) continue;
    receipts.push({
      expectedDate: e.date,
      amount: e.amount,
      currency: e.currency,
      account: e.account,
      source: 'accrual',
      contractId: e.contractId ?? null,
      invoiceId: null,
      obligationId: null,
    });
  }

  if (pipeline !== undefined && rentalIncomeRecurring !== undefined) {
    receipts.push(
      ...rentalIncomeReceiptRows({
        pipeline,
        rentalIncomeRecurring,
        asOf,
        horizon,
        currencyByAccount,
        allowedAccountSet,
      }),
    );
  }

  receipts.sort(compareReceiptRows);

  return { asOf, horizon, receipts };
}

export function composeExpectedReceiptsFromLoaded(
  loaded: LoadedForecastInputs,
  opts: { projectToContractEnd?: boolean } = {},
): ExpectedReceiptsResponse {
  return composeExpectedReceipts({
    asOf: loaded.today,
    horizon: loaded.horizon,
    contracts: loaded.contracts,
    leaveRows: loaded.leaveRows,
    publicHolidayDatesByEntity: loaded.publicHolidayDatesByEntity,
    unpaidInvoices: loaded.unpaidInvoices,
    accountsByEntity: loaded.accountsByEntity,
    currencyByAccount: loaded.currencyByAccount,
    allowedAccountSet: loaded.allowedAccountSet,
    projectToContractEnd: opts.projectToContractEnd,
    accrualWindowStartByContractId: loaded.accrualWindowStartByContractId,
    pipeline: loaded.pipeline,
    rentalIncomeRecurring: selectDeclaredRentalIncomeRows(loaded.pipeline),
  });
}

/** Map a canonical receipt row into a forecast income event for runway walkers. */
export function expectedReceiptRowToIncomeEvent(row: ExpectedReceiptRow): ForecastEvent {
  if (row.source === 'rental-income') {
    return {
      date: row.expectedDate,
      amount: row.amount,
      account: row.account,
      currency: row.currency,
      source: 'recurring',
      label: `Rental ${row.obligationId ?? ''}`,
      obligationId: row.obligationId ?? undefined,
    };
  }
  if (row.source === 'accrual') {
    return {
      date: row.expectedDate,
      amount: row.amount,
      account: row.account,
      currency: row.currency,
      source: 'accrual',
      label: `Accrual ${row.contractId ?? ''}`,
      contractId: row.contractId ?? undefined,
    };
  }
  return {
    date: row.expectedDate,
    amount: row.amount,
    account: row.account,
    currency: row.currency,
    source: 'invoice-receipt',
    label: `Invoice ${row.invoiceId ?? ''}`,
  };
}

/** Loads forecast inputs and composes the canonical expected-receipt list. */
export function buildExpectedReceipts(opts: LoadForecastInputsOpts = {}): ExpectedReceiptsResponse {
  const loaded =
    opts.forecastInputs ??
    loadForecastInputs(opts);
  return composeExpectedReceiptsFromLoaded(loaded, {
    projectToContractEnd: opts.projectToContractEnd,
  });
}
