import { describe, it, expect } from 'vitest';
import { deriveAccountCreditCardConfigMissingWarnings } from './account-credit-card-config-missing.js';
import { ACCOUNT_CONFIG_DATA } from '../accounts/data.js';
import type { AccountConfig } from '../accounts/schema.js';

const allAccounts = Object.values(ACCOUNT_CONFIG_DATA) as AccountConfig[];

describe('deriveAccountCreditCardConfigMissingWarnings', () => {
  it('fires for each credit-card account with no creditCard block', () => {
    const out = deriveAccountCreditCardConfigMissingWarnings({ accounts: allAccounts });
    // Three credit-card accounts in the seed (Barclaycard, Capital on Tap, Santander Everyday),
    // all currently without creditCard blocks.
    expect(out).toHaveLength(3);
    expect(out.map(w => w.context?.account).sort()).toEqual([
      'barclaycard',
      'capital-on-tap',
      'santander-everyday',
    ]);
    for (const w of out) {
      expect(w.severity).toBe('info');
      expect(w.code).toBe('account-credit-card-config-missing');
    }
  });

  it('does NOT fire for non-credit-card accounts', () => {
    const out = deriveAccountCreditCardConfigMissingWarnings({ accounts: allAccounts });
    expect(out.find(w => w.context?.account === 'barclays-current')).toBeUndefined();
    expect(out.find(w => w.context?.account === 'natwest')).toBeUndefined();
  });

  it('does NOT fire when creditCard block is populated', () => {
    const enriched = allAccounts.map(a =>
      a.name === 'barclaycard'
        ? ({ ...a, creditCard: { standardApr: 0.249 } } as AccountConfig)
        : a,
    );
    const out = deriveAccountCreditCardConfigMissingWarnings({ accounts: enriched });
    expect(out.find(w => w.context?.account === 'barclaycard')).toBeUndefined();
    expect(out).toHaveLength(2); // Capital on Tap + Santander Everyday still missing
  });
});
