/**
 * Expected contract receipts — accrual-derived inflows plus unpaid issued
 * invoice receipts. Delegates to {@link collectAccrualEvents} and
 * {@link collectInvoiceReceiptEvents} so amounts/dates match the forecast
 * runway inputs (single source of truth).
 */

import type {
  AccountName,
  Contract,
  CurrencyCode,
  EntityId,
  ExpectedReceiptsResponse,
  Invoice,
  LeaveRow,
} from '../../../shared/api-contracts.js';
import {
  collectAccrualEvents,
  collectInvoiceReceiptEvents,
} from '../forecast/collect-events.js';
import type { LoadForecastInputsOpts } from '../forecast/load-inputs.js';
import { loadForecastInputs } from '../forecast/load-inputs.js';

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
}

/**
 * Pure composition over forecast inputs already loaded for a horizon.
 * Filters each synthetic {@link ForecastEvent} to `allowedAccountSet` so
 * entity-scoped queries match the runway pattern.
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
  } = input;

  const invoicedContractIds = new Set(unpaidInvoices.map(inv => inv.contract_id));

  const accrualEvents = collectAccrualEvents({
    contracts,
    leaveRows,
    publicHolidayDatesByEntity,
    today: asOf,
    horizon,
    accountsByEntity,
    currencyByAccount,
    invoicedContractIds,
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
    });
  }

  receipts.sort((a, b) => {
    const c = a.expectedDate.localeCompare(b.expectedDate);
    if (c !== 0) return c;
    return `${a.source}|${a.contractId ?? ''}|${a.invoiceId ?? ''}`.localeCompare(
      `${b.source}|${b.contractId ?? ''}|${b.invoiceId ?? ''}`,
    );
  });

  return { asOf, horizon, receipts };
}

/** Loads forecast inputs and composes the canonical expected-receipt list. */
export function buildExpectedReceipts(opts: LoadForecastInputsOpts = {}): ExpectedReceiptsResponse {
  const loaded = loadForecastInputs(opts);
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
  });
}
