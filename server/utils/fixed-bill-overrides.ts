/**
 * Config-driven fixed bill overrides for expenses whose amounts vary too much
 * for the recurring detector's amount-bucketing to merge them naturally, or
 * which should surface as fixed without waiting for ~12 months of history.
 *
 * Same idea as RENTAL_PROPERTIES: force all amounts into one accumulator
 * (keyAmount = 0) and stamp a known monthly figure after classification.
 *
 * Optional fields:
 *   - `currency` lets us declare bills paid in a non-GBP account (e.g. AED).
 *     The monthly figure is stored in the account's native currency; the
 *     recurring pipeline converts to GBP for `amount` and preserves the
 *     native figure on `nativeAmount` / `nativeCurrency` for display.
 *   - `relaxedMinMonths` bypasses the standard
 *     `ceil(monthsCovered * 0.5)` gate in the detector, analogous to the
 *     `PROPERTY_INCOME_MIN_MONTHS` branch for rental income. Use for
 *     newly-declared bills that should appear after only 1–2 payments.
 */

import type { CurrencyCode } from '../types.js';

export interface FixedBillOverride {
  merchant: string;
  monthlyAmount: number;
  account: string;
  /** Currency of `monthlyAmount`. Defaults to GBP when absent. */
  currency?: CurrencyCode;
  /** When set, detector uses this minimum months-active instead of the ratio threshold. */
  relaxedMinMonths?: number;
}

export const FIXED_BILL_OVERRIDES: readonly FixedBillOverride[] = [
  { merchant: 'EE', monthlyAmount: 180, account: 'barclays-current' },
  {
    merchant: 'MCE Advisory',
    monthlyAmount: 4200,
    account: 'emirates-islamic',
    currency: 'AED',
    relaxedMinMonths: 2,
  },
];

export function matchFixedBillOverride(
  merchant: string,
  account: string,
): FixedBillOverride | null {
  return FIXED_BILL_OVERRIDES.find(
    o => o.merchant === merchant && o.account === account,
  ) ?? null;
}
