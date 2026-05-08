import { describe, it, expect } from 'vitest';
import { categorizeTransaction } from '../../utils/categorizer.js';
import {
  isTransferDescription,
  isBounceDescription,
  bounceDescriptionSqlPrefilter,
} from '../../config/transfer-patterns.js';
import type { CategoryName } from '../../utils/categorizer.js';

/**
 * Cross-role contract: pairing (`isTransferDescription`, raw description — same as `detectTransfers`)
 * vs first-match category (`categorizeTransaction`, applies NatWest-style normalization internally).
 *
 * When updating transfer or merchant patterns, add or adjust rows here so pairing vs label drift is
 * caught in CI.
 */
const PAIRING_VS_CATEGORY: readonly {
  description: string;
  expectPairingTransferLike: boolean;
  expectCategory: CategoryName;
}[] = [
  {
    description: 'WWW.BARCLAYCARD PAYMENT',
    expectPairingTransferLike: true,
    expectCategory: 'Debt Repayment',
  },
  {
    description: 'CAPITAL ON TAP MONTHLY',
    expectPairingTransferLike: true,
    expectCategory: 'Debt Repayment',
  },
  {
    description: 'SANTANDER CARDS',
    expectPairingTransferLike: true,
    expectCategory: 'Debt Repayment',
  },
  {
    description: 'OPTIONAL FT PAYMENT',
    expectPairingTransferLike: true,
    expectCategory: 'Transfers',
  },
  {
    description: 'TransferWise Ltd fee',
    expectPairingTransferLike: true,
    expectCategory: 'Transfers',
  },
  // Pairing matches /wise/i; merchants row is /TRANSFERWISE/ only — category falls through.
  {
    description: 'WISE PAYMENT REF 123',
    expectPairingTransferLike: true,
    expectCategory: 'Other',
  },
  {
    description: 'BUSINESS PREMIUM STO',
    expectPairingTransferLike: true,
    expectCategory: 'Transfers',
  },
  {
    description: 'Draw down request',
    expectPairingTransferLike: true,
    expectCategory: 'Transfers',
  },
  {
    description: 'Amazon purchase',
    expectPairingTransferLike: false,
    expectCategory: 'Shopping',
  },
];

describe('transfer pattern roles — pairing vs categorization', () => {
  it.each(PAIRING_VS_CATEGORY)(
    '$description → pairing $expectPairingTransferLike, category $expectCategory',
    row => {
      expect(isTransferDescription(row.description)).toBe(row.expectPairingTransferLike);
      expect(categorizeTransaction(row.description)).toBe(row.expectCategory);
    },
  );
});

describe('bounce SQL prefilter vs isBounceDescription', () => {
  const bounceFixtures = [
    'REV PAYMENT 8003',
    '8003 insufficient funds',
    'Insufficient fund return',
    'REV insufficient balance',
    'Returned payment',
    'Payment returned',
  ];

  it('every bounce fixture matches isBounceDescription', () => {
    for (const d of bounceFixtures) {
      expect(isBounceDescription(d), d).toBe(true);
    }
  });

  it('prefilter SQL fragment is non-empty and bracket-balanced', () => {
    const sql = bounceDescriptionSqlPrefilter();
    expect(sql.includes('LIKE')).toBe(true);
    expect((sql.match(/\(/g) ?? []).length).toBe((sql.match(/\)/g) ?? []).length);
  });
});
