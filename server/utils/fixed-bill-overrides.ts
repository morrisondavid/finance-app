/**
 * Config-driven fixed bill overrides for expenses whose amounts vary too much
 * for the recurring detector's amount-bucketing to merge them naturally.
 *
 * Same idea as RENTAL_PROPERTIES: force all amounts into one accumulator
 * (keyAmount = 0) and stamp a known monthly figure after classification.
 */

export interface FixedBillOverride {
  merchant: string;
  monthlyAmount: number;
  account: string;
}

export const FIXED_BILL_OVERRIDES: readonly FixedBillOverride[] = [
  { merchant: 'EE', monthlyAmount: 180, account: 'barclays-current' },
];

export function matchFixedBillOverride(
  merchant: string,
  account: string,
): FixedBillOverride | null {
  return FIXED_BILL_OVERRIDES.find(
    o => o.merchant === merchant && o.account === account,
  ) ?? null;
}
