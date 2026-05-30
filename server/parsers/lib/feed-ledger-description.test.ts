import { describe, it, expect } from 'vitest';
import { expectedFeedLedgerDescription } from './feed-ledger-description.js';
import type { FeedTransactionRow } from '../../ingestion/feeds/model.js';

const row: FeedTransactionRow = {
  date: '2026-04-15',
  description: '78 HUNTERS SQ',
  counterparty: 'Stoneshaw',
  amount: 850,
  currency: 'GBP',
};

describe('expectedFeedLedgerDescription', () => {
  it('Monzo uses counterparty as ledger description', () => {
    expect(expectedFeedLedgerDescription('monzo-joint', row)).toBe('Stoneshaw');
  });

  it('Barclaycard uses Merchant Name column (pre-existing, not Monzo fix)', () => {
    expect(expectedFeedLedgerDescription('barclaycard', row)).toBe('Stoneshaw');
  });

  it('narrative-column banks use provider description unchanged', () => {
    expect(expectedFeedLedgerDescription('barclays-current', row)).toBe('78 HUNTERS SQ');
    expect(expectedFeedLedgerDescription('natwest', row)).toBe('78 HUNTERS SQ');
  });
});
