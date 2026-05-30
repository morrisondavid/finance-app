/**
 * Monzo-only: TrueLayer `merchant_name` vs `description` → Monzo CSV Name/Description.
 *
 * Regression for the Stoneshaw case: TrueLayer sends
 * `description: "78 HUNTERS SQ"`, payee in `meta.counter_party_preferred_name`,
 * and Monzo id in `provider_transaction_id`.
 * Monzo's feed emitter must mirror native export (`Name` = payee, `Description` = detail).
 * Other bank parsers continue to emit `row.description` in their narrative column.
 */

import { describe, it, expect } from 'vitest';
import { parse } from 'csv-parse/sync';
import { PARSERS } from '../../../parsers/index.js';
import type { CSVRow } from '../../../types.js';
import type { InternalFeedTransactions } from '../model.js';
import {
  expectedStoneshawMappedFeedRow,
  nativeMonzoStoneshawCsvRow,
} from './truelayer-transaction-fixtures.js';
import { loadTrueLayerFixture } from './truelayer-fixture-loader.js';

const STONESHA_WINDOW = { dateFrom: '2026-04-21', dateTo: '2026-04-21' };

function stoneshawMonzoFixture(): InternalFeedTransactions {
  return {
    account: 'monzo-joint',
    window: STONESHA_WINDOW,
    rows: [expectedStoneshawMappedFeedRow],
  };
}

function parseMonzoCsv(csv: string): readonly CSVRow[] {
  const parser = PARSERS['monzo-joint'];
  const preprocessed = parser.preprocess(csv);
  return parse(preprocessed, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    ...parser.parseOptions,
  }) as CSVRow[];
}

function csvCell(row: CSVRow, column: string): string {
  if (column in row) return row[column];
  const key = Object.keys(row).find(k => k.toLowerCase() === column.toLowerCase());
  return key !== undefined ? row[key] : '';
}

describe('TrueLayer Stoneshaw — raw API → mapped row', () => {
  it('monzo mapTrueLayerTransaction preserves payee and Monzo id', () => {
    const raw = loadTrueLayerFixture('monzo-joint', 'credit-stoneshaw-fps-rental');
    const mapped = PARSERS['monzo-joint'].mapTrueLayerTransaction!(raw, {
      currency: 'GBP',
      resourceSegment: 'accounts',
    });
    expect(mapped).toEqual(expectedStoneshawMappedFeedRow);
  });
});

describe('TrueLayer Stoneshaw → Monzo CSV', () => {
  it('emitted CSV Name/Description/Transaction ID match native export', () => {
    const csv = PARSERS['monzo-joint'].emitFeedTransactionsAsCsv?.(stoneshawMonzoFixture()) ?? '';
    const records = parseMonzoCsv(csv);
    expect(records[0]).toMatchObject(nativeMonzoStoneshawCsvRow);
  });

  it('transform yields merchant as ledger description', () => {
    const csv = PARSERS['monzo-joint'].emitFeedTransactionsAsCsv?.(stoneshawMonzoFixture()) ?? '';
    const records = parseMonzoCsv(csv);
    const tx = PARSERS['monzo-joint'].transform(records[0], 'monzo-joint');
    expect(tx?.description).toBe('Stoneshaw Estates');
    expect(tx?.externalId).toBe('tx_0000B5VsqK9jVw9TYU2zNi');
  });

  it('raw TrueLayer → map → emit → transform matches native export', () => {
    const raw = loadTrueLayerFixture('monzo-joint', 'credit-stoneshaw-fps-rental');
    const mapped = PARSERS['monzo-joint'].mapTrueLayerTransaction!(raw, {
      currency: 'GBP',
      resourceSegment: 'accounts',
    });
    const fixture: InternalFeedTransactions = {
      account: 'monzo-joint',
      window: STONESHA_WINDOW,
      rows: [mapped],
    };
    const csv = PARSERS['monzo-joint'].emitFeedTransactionsAsCsv?.(fixture) ?? '';
    const records = parseMonzoCsv(csv);
    const tx = PARSERS['monzo-joint'].transform(records[0], 'monzo-joint');
    expect(tx?.description).toBe(nativeMonzoStoneshawCsvRow.Name);
    expect(tx?.externalId).toBe(nativeMonzoStoneshawCsvRow['Transaction ID']);
  });
});

describe('TrueLayer Stoneshaw — non-Monzo parsers keep provider narrative', () => {
  const nonMonzoCases = [
    { account: 'barclays-current' as const, column: 'Memo' },
    { account: 'natwest' as const, column: 'Description' },
  ] as const;

  it.each(nonMonzoCases)('$account emits address line in $column, not merchant', ({ account, column }) => {
    const parser = PARSERS[account];
    const fixture: InternalFeedTransactions = {
      account,
      window: STONESHA_WINDOW,
      rows: [expectedStoneshawMappedFeedRow],
    };
    const csv = parser.emitFeedTransactionsAsCsv?.(fixture) ?? '';
    const records = parse(parser.preprocess(csv), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      ...parser.parseOptions,
    }) as CSVRow[];
    expect(csvCell(records[0], column)).toBe('78 HUNTERS SQ');
    expect(csvCell(records[0], column)).not.toBe('Stoneshaw Estates');
  });
});
