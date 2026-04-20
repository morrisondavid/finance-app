import { describe, it, expect } from 'vitest';
import {
  FIXED_BILL_OVERRIDES,
  matchFixedBillOverride,
} from './fixed-bill-overrides.js';

describe('FIXED_BILL_OVERRIDES', () => {
  it('includes MCE Advisory as an AED bill on emirates-islamic with relaxed detection', () => {
    const mce = FIXED_BILL_OVERRIDES.find(o => o.merchant === 'MCE Advisory');
    expect(mce).toBeDefined();
    expect(mce!.monthlyAmount).toBe(4200);
    expect(mce!.account).toBe('emirates-islamic');
    expect(mce!.currency).toBe('AED');
    expect(mce!.relaxedMinMonths).toBe(2);
  });

  it('keeps the existing EE entry as a GBP bill with no relaxation (backward compatible)', () => {
    const ee = FIXED_BILL_OVERRIDES.find(o => o.merchant === 'EE');
    expect(ee).toBeDefined();
    expect(ee!.monthlyAmount).toBe(180);
    expect(ee!.account).toBe('barclays-current');
    expect(ee!.currency).toBeUndefined();
    expect(ee!.relaxedMinMonths).toBeUndefined();
  });
});

describe('matchFixedBillOverride', () => {
  it('returns the MCE Advisory record for a matching merchant/account pair', () => {
    const match = matchFixedBillOverride('MCE Advisory', 'emirates-islamic');
    expect(match).not.toBeNull();
    expect(match!.currency).toBe('AED');
    expect(match!.relaxedMinMonths).toBe(2);
  });

  it('returns null when the merchant matches but the account does not', () => {
    expect(matchFixedBillOverride('MCE Advisory', 'barclays-current')).toBeNull();
  });

  it('returns null when the account matches but the merchant does not', () => {
    expect(matchFixedBillOverride('Random Vendor', 'emirates-islamic')).toBeNull();
  });

  it('returns the EE record for the existing barclays-current entry', () => {
    const match = matchFixedBillOverride('EE', 'barclays-current');
    expect(match).not.toBeNull();
    expect(match!.monthlyAmount).toBe(180);
  });
});
