/**
 * TrueLayer-normalized rows → bank CSV → parser transform round-trip.
 *
 * Live TrueLayer **card** fetches may use different amount/balance semantics;
 * these tests validate the internal → CSV → parser contract once rows are in
 * {@link InternalFeedTransactions} shape (not the not-yet-built cards adapter).
 */

import { describe, it, expect } from 'vitest';
import { parse } from 'csv-parse/sync';
import type { AccountName } from '../../../domain/accounts/index.js';
import { isCreditCard, isValidAccountName } from '../../../domain/accounts/index.js';
import { PARSERS, normaliseCreditCardAmounts } from '../../../parsers/index.js';
import type { BankParser, CSVRow } from '../../../types.js';
import type { InternalFeedTransactions } from '../model.js';
import {
  DATE_FROM,
  DATE_TO,
  expectedMappedFeedTransactionRows,
} from './truelayer-transaction-fixtures.js';

interface RoundTripCase {
  readonly account: AccountName;
  readonly parser: BankParser;
}

const ROUND_TRIP_CASES: readonly RoundTripCase[] = [
  { account: 'barclays-current', parser: PARSERS['barclays-current'] },
  { account: 'natwest', parser: PARSERS['natwest'] },
  { account: 'monzo-joint', parser: PARSERS['monzo-joint'] },
  { account: 'wise-ltd', parser: PARSERS['wise-ltd'] },
  { account: 'barclaycard', parser: PARSERS['barclaycard'] },
  { account: 'santander-everyday', parser: PARSERS['santander-everyday'] },
];

function makeTrueLayerMappedFixture(account: AccountName): InternalFeedTransactions {
  if (!isValidAccountName(account)) {
    throw new Error(`Test fixture references invalid account ${account}`);
  }
  return {
    account,
    window: { dateFrom: DATE_FROM, dateTo: DATE_TO },
    rows: expectedMappedFeedTransactionRows,
  };
}

function parseCsvForAccount(parser: BankParser, csv: string): readonly CSVRow[] {
  const preprocessed = parser.preprocess(csv);
  return parse(preprocessed, {
    columns: parser.columns === 'auto' ? true : parser.columns,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    ...parser.parseOptions,
  }) as CSVRow[];
}

function emitFor(parser: BankParser, fixture: InternalFeedTransactions): string {
  if (parser.emitFeedTransactionsAsCsv === undefined) {
    throw new Error('Parser does not implement emitFeedTransactionsAsCsv');
  }
  return parser.emitFeedTransactionsAsCsv(fixture);
}

describe.each(ROUND_TRIP_CASES)(
  'TrueLayer mapped rows → CSV → transform — $account',
  testCase => {
    it('round-trips amount and date through the bank parser', () => {
      const fixture = makeTrueLayerMappedFixture(testCase.account);
      const csv = emitFor(testCase.parser, fixture);
      const records = parseCsvForAccount(testCase.parser, csv);
      expect(records).toHaveLength(fixture.rows.length);

      for (let i = 0; i < fixture.rows.length; i++) {
        const expected = fixture.rows[i];
        const parsed = testCase.parser.transform(records[i], testCase.account);
        expect(parsed, `row ${i.toString()} should parse`).not.toBeNull();
        if (parsed === null || expected === undefined) continue;

        const finalised =
          isValidAccountName(testCase.account) && isCreditCard(testCase.account)
            ? normaliseCreditCardAmounts(parsed, testCase.account)
            : parsed;

        expect(finalised.amount, `row ${i.toString()} amount`).toBeCloseTo(expected.amount, 2);

        const expectedIso = expected.date;
        const actualIso = `${finalised.date.getFullYear().toString()}-${String(finalised.date.getMonth() + 1).padStart(2, '0')}-${String(finalised.date.getDate()).padStart(2, '0')}`;
        expect(actualIso, `row ${i.toString()} date`).toBe(expectedIso);
      }
    });

    it('first CSV line equals parser.headers.join(",")', () => {
      const fixture = makeTrueLayerMappedFixture(testCase.account);
      const csv = emitFor(testCase.parser, fixture);
      expect(csv.split('\n')[0]).toBe(testCase.parser.headers.join(','));
    });
  },
);
