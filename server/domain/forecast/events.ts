/**
 * Forecast event model — a single dated cash movement.
 *
 * Every data source (obligations, recurring expenses, invoice
 * receipts, accrued income) is normalised into this shape before the
 * timeline walker processes it. Positive `amount` = inflow, negative
 * = outflow. `account` pins the event to a specific bank account so
 * the walker can track per-account running balances.
 */

import type { AccountName, CurrencyCode } from '../../../shared/api-contracts.js';

export type ForecastEventSource =
  | 'obligation'
  | 'recurring'
  | 'invoice-receipt'
  | 'accrual';

export interface ForecastEvent {
  readonly date: string;
  readonly amount: number;
  readonly account: AccountName;
  readonly currency: CurrencyCode;
  readonly source: ForecastEventSource;
  readonly label: string;
  /** When `source === 'accrual'`, the contract that produced this inflow. */
  readonly contractId?: string;
}
