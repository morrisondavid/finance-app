/**
 * Pre-migration parity snapshot (Phase A2b → locked post-A3).
 *
 * Captured byte-for-byte from the OLD functions in `server/types.ts`
 * before Phase A3 deleted them. These values are the contract of the
 * accounts registry — the NEW queries MUST return these exact lists
 * for every scope that existed in the legacy surface.
 *
 * Any divergence here is a migration bug. Do not loosen these values:
 * if the config changes such that the expected set legitimately moves,
 * the _consumer_ of that gate should also change, and this file should
 * be updated in the same commit as the config change.
 */

import { describe, it, expect } from 'vitest';
import type { EntityId } from '../../../shared/api-contracts.js';
import {
  vatApplicableAccounts,
  corpTaxApplicableAccounts,
  businessPaymentAccounts,
  personalPaymentAccounts,
  businessAndPersonalPaymentAccounts,
  accountsForEntity,
  getEntityIdForAccount,
  isBusinessAccount,
  isCreditCard,
  isCrossAccountBusinessToBusinessTransfer,
} from './queries.js';
import { ACCOUNTS } from '../../../shared/api-contracts.js';

describe('locked snapshot — vatApplicableAccounts', () => {
  const cases: readonly { scope: EntityId | undefined; expected: readonly string[] }[] = [
    { scope: undefined, expected: ['barclays-current'] },
    { scope: 'autonize-it-ltd', expected: ['barclays-current'] },
    { scope: 'autonize-it-fzco', expected: [] },
  ];
  for (const { scope, expected } of cases) {
    it(`scope ${scope ?? '(none)'}`, () => {
      const result = vatApplicableAccounts(scope === undefined ? undefined : { entityId: scope });
      expect([...result].sort()).toEqual([...expected].sort());
    });
  }
});

describe('locked snapshot — corpTaxApplicableAccounts', () => {
  const cases: readonly { scope: EntityId | undefined; expected: readonly string[] }[] = [
    { scope: undefined, expected: ['barclays-current'] },
    { scope: 'autonize-it-ltd', expected: ['barclays-current'] },
    { scope: 'autonize-it-fzco', expected: [] },
  ];
  for (const { scope, expected } of cases) {
    it(`scope ${scope ?? '(none)'}`, () => {
      const result = corpTaxApplicableAccounts(scope === undefined ? undefined : { entityId: scope });
      expect([...result].sort()).toEqual([...expected].sort());
    });
  }
});

describe('locked snapshot — payment account enumerations', () => {
  it('businessPaymentAccounts', () => {
    expect([...businessPaymentAccounts()].sort()).toEqual(
      [
        'barclaycard',
        'barclays-current',
        'capital-on-tap',
        'emirates-islamic',
        'emirates-islamic-gbp',
        'emirates-islamic-usd',
        'wise-ltd',
      ],
    );
  });

  it('personalPaymentAccounts', () => {
    expect([...personalPaymentAccounts()].sort()).toEqual(
      ['mbna', 'monzo-joint', 'natwest', 'santander-everyday'],
    );
  });

  it('businessAndPersonalPaymentAccounts', () => {
    expect([...businessAndPersonalPaymentAccounts()].sort()).toEqual(
      [
        'barclaycard',
        'barclays-current',
        'capital-on-tap',
        'emirates-islamic',
        'emirates-islamic-gbp',
        'emirates-islamic-usd',
        'mbna',
        'monzo-joint',
        'natwest',
        'santander-everyday',
        'wise-ltd',
      ],
    );
  });
});

describe('locked snapshot — accountsForEntity', () => {
  const cases: readonly { scope: EntityId | null; expected: readonly string[] }[] = [
    { scope: null, expected: ['mbna', 'monzo-joint', 'natwest', 'natwest-savings', 'santander-everyday'] },
    {
      scope: 'autonize-it-ltd',
      expected: ['barclaycard', 'barclays-current', 'barclays-savings', 'capital-on-tap', 'wise-ltd'],
    },
    { scope: 'autonize-it-fzco', expected: ['emirates-islamic', 'emirates-islamic-gbp', 'emirates-islamic-usd'] },
  ];
  for (const { scope, expected } of cases) {
    it(`scope ${scope ?? '(null)'}`, () => {
      expect([...accountsForEntity(scope)].sort()).toEqual([...expected].sort());
    });
  }
});

describe('locked snapshot — per-account predicates', () => {
  it('getEntityIdForAccount maps every account to its entity', () => {
    const expected: Record<string, EntityId | null> = {
      'barclays-current': 'autonize-it-ltd',
      'barclays-savings': 'autonize-it-ltd',
      'capital-on-tap': 'autonize-it-ltd',
      'barclaycard': 'autonize-it-ltd',
      'natwest': null,
      'natwest-savings': null,
      'monzo-joint': null,
      'emirates-islamic': 'autonize-it-fzco',
      'emirates-islamic-gbp': 'autonize-it-fzco',
      'emirates-islamic-usd': 'autonize-it-fzco',
      'santander-everyday': null,
      'mbna': null,
      'wise-ltd': 'autonize-it-ltd',
    };
    for (const a of ACCOUNTS) {
      expect(getEntityIdForAccount(a)).toBe(expected[a]);
    }
  });

  it('isBusinessAccount is true for business accounts, false for personal', () => {
    const expected: Record<string, boolean> = {
      'barclays-current': true,
      'barclays-savings': true,
      'capital-on-tap': true,
      'barclaycard': true,
      'natwest': false,
      'natwest-savings': false,
      'monzo-joint': false,
      'emirates-islamic': true,
      'emirates-islamic-gbp': true,
      'emirates-islamic-usd': true,
      'santander-everyday': false,
      'mbna': false,
      'wise-ltd': true,
    };
    for (const a of ACCOUNTS) {
      expect(isBusinessAccount(a)).toBe(expected[a]);
    }
  });

  it('isBusinessAccount returns false for unknown ids', () => {
    expect(isBusinessAccount('ghost')).toBe(false);
    expect(isBusinessAccount('')).toBe(false);
    expect(isBusinessAccount('BARCLAYS-CURRENT')).toBe(false);
  });

  it('isCreditCard is true exactly for credit-card accounts', () => {
    const expected: Record<string, boolean> = {
      'barclays-current': false,
      'barclays-savings': false,
      'capital-on-tap': true,
      'barclaycard': true,
      'natwest': false,
      'natwest-savings': false,
      'monzo-joint': false,
      'emirates-islamic': false,
      'emirates-islamic-gbp': false,
      'emirates-islamic-usd': false,
      'santander-everyday': true,
      'mbna': true,
      'wise-ltd': false,
    };
    for (const a of ACCOUNTS) {
      expect(isCreditCard(a)).toBe(expected[a]);
    }
  });
});

describe('locked snapshot — isCrossAccountBusinessToBusinessTransfer', () => {
  it('same account → false', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'barclays-current')).toBe(false);
  });

  it('UK Ltd → UK Ltd (different account) → true', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'capital-on-tap')).toBe(true);
    expect(isCrossAccountBusinessToBusinessTransfer('capital-on-tap', 'barclays-current')).toBe(true);
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'barclays-savings')).toBe(true);
  });

  it('UK Ltd ↔ UAE FZCO → false (inter-company)', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'emirates-islamic')).toBe(false);
    expect(isCrossAccountBusinessToBusinessTransfer('emirates-islamic', 'barclays-current')).toBe(false);
  });

  it('business ↔ personal → false', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'natwest')).toBe(false);
    expect(isCrossAccountBusinessToBusinessTransfer('natwest', 'barclays-current')).toBe(false);
  });

  it('personal ↔ personal → false', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('natwest', 'monzo-joint')).toBe(false);
  });

  it('unknown id on either side → false', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'ghost')).toBe(false);
    expect(isCrossAccountBusinessToBusinessTransfer('ghost', 'barclays-current')).toBe(false);
    expect(isCrossAccountBusinessToBusinessTransfer('', '')).toBe(false);
  });
});
