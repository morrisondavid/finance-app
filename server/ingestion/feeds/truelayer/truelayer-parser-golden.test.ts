/**
 * Golden tests: real captured TrueLayer JSON → parser map → emit → transform.
 */

import { describe, it, expect } from 'vitest';
import { parse } from 'csv-parse/sync';
import type { AccountName } from '../../../../shared/api-contracts.js';
import { getAccountConfig, isCreditCard } from '../../../domain/accounts/index.js';
import { PARSERS, normaliseCreditCardAmounts } from '../../../parsers/index.js';
import type { BankParser, CSVRow } from '../../../types.js';
import { generateRowKey } from '../../../utils/csv-partitioner.js';
import { trueLayerDataResourceSegment } from './truelayer-data-resource.js';
import { listTrueLayerFixtures } from './truelayer-fixture-loader.js';

const LINKED_TRUE_LAYER_ACCOUNTS: readonly AccountName[] = [
  'monzo-joint',
  'barclays-current',
  'barclays-savings',
  'natwest',
  'wise-ltd',
];

function parseCsvForParser(parser: BankParser, csv: string): readonly CSVRow[] {
  const preprocessed = parser.preprocess(csv);
  return parse(preprocessed, {
    columns: parser.columns === 'auto' ? true : parser.columns,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    ...parser.parseOptions,
  }) as CSVRow[];
}

function mapCtx(account: AccountName) {
  return {
    currency: getAccountConfig(account).currency,
    resourceSegment: trueLayerDataResourceSegment(account),
  };
}

describe('TrueLayer fixture coverage', () => {
  it('every configured linked account has at least one committed fixture', () => {
    for (const account of LINKED_TRUE_LAYER_ACCOUNTS) {
      const fixtures = listTrueLayerFixtures(account);
      expect(fixtures.length, `${account} should have fixtures`).toBeGreaterThan(0);
    }
  });

  it('every TrueLayer-linked parser implements mapTrueLayerTransaction and emitFeedTransactionsAsCsv', () => {
    for (const account of LINKED_TRUE_LAYER_ACCOUNTS) {
      const parser = PARSERS[account];
      expect(parser?.mapTrueLayerTransaction).toBeTypeOf('function');
      expect(parser?.emitFeedTransactionsAsCsv).toBeTypeOf('function');
    }
  });
});

describe.each(listTrueLayerFixtures())(
  'TrueLayer golden — $account / $slug',
  fixture => {
    const parser = PARSERS[fixture.account];
    const ctx = mapCtx(fixture.account);

    it('maps raw API row to FeedTransactionRow', () => {
      expect(parser.mapTrueLayerTransaction).toBeTypeOf('function');
      const mapped = parser.mapTrueLayerTransaction!(fixture.raw, ctx);
      expect(mapped.currency).toBe(ctx.currency);
      expect(mapped.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(mapped.description).toBe(fixture.raw.description);
      expect(Number.isFinite(mapped.amount)).toBe(true);
      expect(mapped.externalId).toBe(fixture.raw.transaction_id);
    });

    it('round-trips through emit → transform with stable amount and date', () => {
      const mapped = parser.mapTrueLayerTransaction!(fixture.raw, ctx);
      const csv = parser.emitFeedTransactionsAsCsv!({
        account: fixture.account,
        window: { dateFrom: mapped.date, dateTo: mapped.date },
        rows: [mapped],
      });
      const records = parseCsvForParser(parser, csv);
      expect(records.length).toBe(1);
      let tx = parser.transform(records[0], fixture.account);
      expect(tx).not.toBeNull();
      if (tx === null) return;
      if (isCreditCard(fixture.account)) {
        tx = normaliseCreditCardAmounts(tx, fixture.account);
      }
      expect(tx.amount).toBeCloseTo(mapped.amount, 2);
      const emittedDateStr = records[0][parser.dateColumn] ?? '';
      const fromEmit = parser.parseDate(emittedDateStr);
      expect(fromEmit?.getTime()).toBe(tx.date.getTime());
    });

    it('emits CSV with dedup key from external id column when parser defines one', () => {
      if (parser.externalIdColumn === undefined) return;
      const mapped = parser.mapTrueLayerTransaction!(fixture.raw, ctx);
      const csv = parser.emitFeedTransactionsAsCsv!({
        account: fixture.account,
        window: { dateFrom: mapped.date, dateTo: mapped.date },
        rows: [mapped],
      });
      const records = parseCsvForParser(parser, csv);
      const key = generateRowKey(records[0], parser);
      expect(key.startsWith('externalId:')).toBe(
        (records[0][parser.externalIdColumn]?.trim() ?? '') !== '',
      );
    });
  },
);

describe('Monzo Stoneshaw FPS rental fixture', () => {
  it('maps payee and Monzo transaction id for dedup with native export', () => {
    const raw = listTrueLayerFixtures('monzo-joint').find(
      f => f.slug === 'credit-stoneshaw-fps-rental',
    )?.raw;
    expect(raw).toBeDefined();
    if (raw === undefined) return;

    const mapped = PARSERS['monzo-joint'].mapTrueLayerTransaction!(raw, mapCtx('monzo-joint'));
    expect(mapped.reference).toBe('tx_0000B5VsqK9jVw9TYU2zNi');
    expect(mapped.counterparty).toBe('Stoneshaw Estates');
    expect(mapped.description).toBe('78 HUNTERS SQ');

    const csv = PARSERS['monzo-joint'].emitFeedTransactionsAsCsv!({
      account: 'monzo-joint',
      window: { dateFrom: '2026-04-21', dateTo: '2026-04-21' },
      rows: [mapped],
    });
    const records = parseCsvForParser(PARSERS['monzo-joint'], csv);
    expect(records[0]['Transaction ID']).toBe('tx_0000B5VsqK9jVw9TYU2zNi');
    expect(records[0].Name).toBe('Stoneshaw Estates');
    expect(records[0].Description).toBe('78 HUNTERS SQ');

    const nativeExport = {
      'Transaction ID': 'tx_0000B5VsqK9jVw9TYU2zNi',
      Date: '21/04/2026',
      Name: 'Stoneshaw Estates',
      Description: '78 HUNTERS SQ',
      Amount: '1292.72',
    };
    expect(generateRowKey(records[0], PARSERS['monzo-joint'])).toBe(
      generateRowKey(nativeExport, PARSERS['monzo-joint']),
    );
  });
});
