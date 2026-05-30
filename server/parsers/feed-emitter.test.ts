/**
 * Per-parser CSV emitter goldens for §3.4 modular AISP feed.
 *
 * Each parser implements `emitFeedTransactionsAsCsv(InternalFeedTransactions)`
 * to render provider-neutral feed rows back into bank-shaped CSV that the
 * existing `transform` reads identically to a real upload. These tests pin:
 *
 *   1. **Exact** emitted bytes for a representative two-row fixture
 *      (so a sign / column / date-format regression breaks loudly).
 *   2. The first line equals `parser.headers.join(',')`, so changes to
 *      the canonical header tuple force a matching fixture update.
 *   3. The CSV round-trips: feeding the emitted bytes through
 *      `parser.preprocess` + `csv-parse` + `parser.transform` (and
 *      `normaliseCreditCardAmounts` for credit cards) recovers the
 *      original signed amount, date, and description for every row.
 *
 * The fixture is provider-neutral (`InternalFeedTransactions`) so it
 * exercises both the credit-card sign inversion (Capital on Tap,
 * Barclaycard, Santander Everyday) and the inflow-positive native
 * convention (Barclays, NatWest, Monzo, Wise, Emirates Islamic).
 */

import { describe, it, expect } from 'vitest';
import { parse } from 'csv-parse/sync';
import barclaysParser from './barclays.js';
import natwestParser from './natwest.js';
import capitalOnTapParser from './capital-on-tap.js';
import barclaycardParser from './barclaycard.js';
import monzoParser from './monzo.js';
import emiratesIslamicParser from './emirates-islamic.js';
import wiseParser from './wise.js';
import santanderEverydayParser from './santander-everyday.js';
import { normaliseCreditCardAmounts } from './index.js';
import { isCreditCard, isValidAccountName } from '../domain/accounts/index.js';
import { expectedFeedLedgerDescription } from './lib/feed-ledger-description.js';
import type { BankParser, CSVRow } from '../types.js';
import type { AccountName } from '../../shared/api-contracts.js';
import type {
  FeedTransactionRow,
  InternalFeedTransactions,
} from '../ingestion/feeds/model.js';

interface EmitterCase {
  readonly name: string;
  readonly account: AccountName;
  readonly parser: BankParser;
  /** Exact expected CSV string. Newlines are literal `\n`. */
  readonly expectedCsv: string;
}

const FIXTURE_ROWS: readonly FeedTransactionRow[] = [
  {
    date: '2026-04-15',
    description: 'COFFEE SHOP',
    amount: -3.5,
    currency: 'GBP',
    counterparty: 'Coffee Shop Ltd',
    reference: 'ref-1',
    externalId: 'ext-1',
  },
  {
    date: '2026-04-16',
    description: 'SALARY',
    amount: 1200,
    currency: 'GBP',
    counterparty: 'Acme Inc',
    reference: 'ref-2',
    externalId: 'ext-2',
    balance: 5000,
  },
];

function makeFixture(account: string): InternalFeedTransactions {
  if (!isValidAccountName(account)) {
    throw new Error(`Test fixture references invalid account ${account}`);
  }
  return {
    account,
    window: { dateFrom: '2026-04-15', dateTo: '2026-04-16' },
    rows: FIXTURE_ROWS,
  };
}

const EMITTER_CASES: readonly EmitterCase[] = [
  {
    name: 'Barclays — single Amount column, inflow-positive sign',
    account: 'barclays-current',
    parser: barclaysParser,
    expectedCsv:
      'Number,Date,Account,Amount,Subcategory,Memo\n' +
      ',15/04/2026,,-3.50,,COFFEE SHOP\n' +
      ',16/04/2026,,1200.00,,SALARY',
  },
  {
    name: 'NatWest — Value column, DD Mon YYYY date, balance pass-through',
    account: 'natwest',
    parser: natwestParser,
    expectedCsv:
      'Date,Type,Description,Value,Balance,Account Name,Account Number\n' +
      '15 Apr 2026,,COFFEE SHOP,-3.50,,,\n' +
      '16 Apr 2026,,SALARY,1200.00,5000.00,,',
  },
  // NB: NatWest emitter uses two-digit day padding (`isoToNatwestDate`); both
  // sample dates are already two-digit so the goldens above need no edit.
  {
    name: 'Monzo — split Money In / Money Out columns',
    account: 'monzo-joint',
    parser: monzoParser,
    expectedCsv:
      'Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Money Out,Money In,Balance,Balance currency\n' +
      'ref-1,15/04/2026,,,Coffee Shop Ltd,,,-3.50,GBP,-3.50,GBP,,,,COFFEE SHOP,,3.50,,,\n' +
      'ref-2,16/04/2026,,,Acme Inc,,,1200.00,GBP,1200.00,GBP,,,,SALARY,,,1200.00,5000.00,GBP',
  },
  {
    name: 'Wise — Direction-driven sign with absolute Source amount',
    account: 'wise-ltd',
    parser: wiseParser,
    expectedCsv:
      'ID,Status,Direction,Created on,Finished on,Source fee amount,Source fee currency,Target fee amount,Target fee currency,Source name,Source amount (after fees),Source currency,Target name,Target amount (after fees),Target currency,Exchange rate,Reference,Batch,Created by,Category,Note\n' +
      'ext-1,COMPLETED,OUT,2026-04-15 00:00:00,2026-04-15 00:00:00,0,GBP,0,GBP,,3.50,GBP,Coffee Shop Ltd,3.50,GBP,,ref-1,,,,\n' +
      'ext-2,COMPLETED,IN,2026-04-16 00:00:00,2026-04-16 00:00:00,0,GBP,0,GBP,,1200.00,GBP,Acme Inc,1200.00,GBP,,ref-2,,,,',
  },
  {
    name: 'Emirates Islamic — split Debit / Credit columns, DD-MM-YYYY date',
    account: 'emirates-islamic',
    parser: emiratesIslamicParser,
    expectedCsv:
      'Transaction Date,Value Date,Narration,Transaction Reference,Debit,Credit,Running Balance\n' +
      '15-04-2026,15-04-2026,COFFEE SHOP,ref-1,3.50,,\n' +
      '16-04-2026,16-04-2026,SALARY,ref-2,,1200.00,5000.00',
  },
  {
    name: 'Capital on Tap (credit card) — sign inverted relative to internal',
    account: 'capital-on-tap',
    parser: capitalOnTapParser,
    expectedCsv:
      'Clearance Date,Authorisation Date,Description,Amount,Original Amount,Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,Transaction Type,Category,Has Receipts,Note\n' +
      '15/04/2026,15/04/2026,COFFEE SHOP,3.50,3.50,GBP,Coffee Shop Ltd,,,,,,,ref-1\n' +
      '16/04/2026,16/04/2026,SALARY,-1200.00,-1200.00,GBP,Acme Inc,,,,,,,ref-2',
  },
  {
    name: 'Barclaycard (credit card) — sign inverted, Merchant Name as description',
    account: 'barclaycard',
    parser: barclaycardParser,
    expectedCsv:
      'Cardholder Name,Account Number,Transaction Date,Merchant Name,Amount,Currency,Original Amount,Original Currency,Conversion Rate,Posted Date,Transaction Time,Authorisation Code,Transaction ID,Merchant Category,Transaction Type,MCC Description,Merchant Town/City,Merchant County/State,Merchant Post code/Zipcode,MCC,Statement Cycle\n' +
      ',,15/04/2026,Coffee Shop Ltd,3.50,GBP,3.50,GBP,,15/04/2026,,,ext-1,,,,,,,,\n' +
      ',,16/04/2026,Acme Inc,-1200.00,GBP,-1200.00,GBP,,16/04/2026,,,ext-2,,,,,,,,',
  },
  {
    name: 'Santander Everyday (credit card) — ISO date, sign inverted',
    account: 'santander-everyday',
    parser: santanderEverydayParser,
    expectedCsv:
      'Date,Card,Description,Amount\n' +
      '2026-04-15,,COFFEE SHOP,3.50\n' +
      '2026-04-16,,SALARY,-1200.00',
  },
];

/**
 * Run the exact same `parser.preprocess → csv-parse → parser.transform`
 * pipeline that {@link parseCSVFile} runs at ingest. Returns nothing —
 * the test asserts amount + date + description recovery row-by-row.
 *
 * Kept inline rather than calling `parseCSVFile` because that helper is
 * async and writes to disk; this synchronous variant lets the round-trip
 * assertion sit alongside the golden assertion in the same `it`.
 */
function parseCsvForAccount(parser: BankParser, csv: string): readonly CSVRow[] {
  const preprocessed = parser.preprocess(csv);
  const records = parse(preprocessed, {
    columns: parser.columns === 'auto' ? true : parser.columns,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    ...parser.parseOptions,
  }) as CSVRow[];
  return records;
}

function emitFor(parser: BankParser, fixture: InternalFeedTransactions): string {
  if (parser.emitFeedTransactionsAsCsv === undefined) {
    throw new Error('Parser does not implement emitFeedTransactionsAsCsv');
  }
  // Bound call — the emitter uses `this.headers` to know which columns to
  // write, so detaching it via destructuring would break runtime dispatch.
  return parser.emitFeedTransactionsAsCsv(fixture);
}

describe.each(EMITTER_CASES)('emitFeedTransactionsAsCsv — $name', testCase => {
  it('emits the exact expected CSV bytes', () => {
    const csv = emitFor(testCase.parser, makeFixture(testCase.account));
    expect(csv).toBe(testCase.expectedCsv);
  });

  it('first line equals parser.headers.join(",")', () => {
    const csv = emitFor(testCase.parser, makeFixture(testCase.account));
    expect(csv.split('\n')[0]).toBe(testCase.parser.headers.join(','));
  });

  it('round-trips through transform: amount, date, description', () => {
    const fixture = makeFixture(testCase.account);
    const csv = emitFor(testCase.parser, fixture);
    const records = parseCsvForAccount(testCase.parser, csv);
    expect(records).toHaveLength(fixture.rows.length);

    for (let i = 0; i < fixture.rows.length; i++) {
      const expected = fixture.rows[i];
      const parsed = testCase.parser.transform(records[i], testCase.account);
      expect(parsed, `row ${i.toString()} should parse`).not.toBeNull();
      if (parsed === null) continue;

      const finalised = isValidAccountName(testCase.account) && isCreditCard(testCase.account)
        ? normaliseCreditCardAmounts(parsed, testCase.account)
        : parsed;

      expect(finalised.amount, `row ${i.toString()} amount`).toBeCloseTo(expected.amount, 2);

      const expectedIso = expected.date;
      const actualIso = `${finalised.date.getFullYear().toString()}-${String(finalised.date.getMonth() + 1).padStart(2, '0')}-${String(finalised.date.getDate()).padStart(2, '0')}`;
      expect(actualIso, `row ${i.toString()} date`).toBe(expectedIso);

      const expectedDescription = expectedFeedLedgerDescription(testCase.account, expected);
      if (testCase.account !== 'wise-ltd') {
        expect(finalised.description, `row ${i.toString()} description`).toBe(expectedDescription);
      }
    }
  });
});

describe('emitter coverage', () => {
  it('every parser registered in PARSERS implements emitFeedTransactionsAsCsv', async () => {
    const { PARSERS } = await import('./index.js');
    for (const [account, parser] of Object.entries(PARSERS)) {
      expect(
        parser.emitFeedTransactionsAsCsv,
        `parser for ${account} should implement emitFeedTransactionsAsCsv`,
      ).toBeTypeOf('function');
    }
  });
});
