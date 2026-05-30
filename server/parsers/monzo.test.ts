/**
 * Monzo parser — Transaction ID dedup, amount fallback, feed emitter alignment.
 */

import { describe, it, expect } from 'vitest';
import { parse } from 'csv-parse/sync';
import monzoParser, {
  parseMonzoSignedAmount,
  getMonzoColumnValue,
} from './monzo.js';
import { generateRowKey, deduplicateRows } from '../utils/csv-partitioner.js';
import { generateTransactionHash } from '../db/connection.js';
import type { CSVRow, Transaction } from '../types.js';
import type { FeedTransactionRow, InternalFeedTransactions } from '../ingestion/feeds/model.js';

function csvRow(overrides: Record<string, string>): CSVRow {
  return overrides;
}

describe('monzo parser transform', () => {
  it('reads Transaction ID as externalId', () => {
    const row = csvRow({
      'Transaction ID': 'txmonzo123',
      Date: '15/04/2026',
      Name: 'Stoneshaw',
      Description: '78 HUNTERS SQ',
      Amount: '850.00',
    });
    const tx = monzoParser.transform(row, 'monzo-joint');
    expect(tx?.externalId).toBe('txmonzo123');
    expect(tx?.description).toBe('Stoneshaw');
    expect(tx?.amount).toBe(850);
  });

  it('derives signed amount from Money In when Amount is empty', () => {
    const row = csvRow({
      Date: '15/04/2026',
      Name: 'Salary',
      Amount: '',
      'Money In': '1200.00',
      'Money Out': '',
    });
    expect(parseMonzoSignedAmount(row)).toBe(1200);
    const tx = monzoParser.transform(row, 'monzo-joint');
    expect(tx?.amount).toBe(1200);
  });

  it('derives signed amount from Money Out when Amount is empty', () => {
    const row = csvRow({
      Date: '15/04/2026',
      Name: 'Shop',
      Amount: '',
      'Money In': '',
      'Money Out': '3.50',
    });
    expect(parseMonzoSignedAmount(row)).toBe(-3.5);
  });
});

describe('Monzo Transaction ID dedup', () => {
  const exportRow = csvRow({
    'Transaction ID': 'tx-dup-1',
    Date: '15/04/2026',
    Name: 'Stoneshaw',
    Description: '78 HUNTERS SQ',
    Amount: '-850.00',
  });

  const feedRow = csvRow({
    'Transaction ID': 'tx-dup-1',
    Date: '15/04/2026',
    Name: '78 HUNTERS SQ',
    Description: '78 HUNTERS SQ',
    Amount: '-850.00',
  });

  it('generateRowKey uses external id when present', () => {
    expect(generateRowKey(exportRow, monzoParser)).toBe('externalId:tx-dup-1');
    expect(generateRowKey(feedRow, monzoParser)).toBe('externalId:tx-dup-1');
    expect(generateRowKey(exportRow, monzoParser)).toBe(generateRowKey(feedRow, monzoParser));
  });

  it('deduplicateRows keeps one row when Transaction ID matches despite different Name', () => {
    const deduped = deduplicateRows([exportRow, feedRow], monzoParser);
    expect(deduped).toHaveLength(1);
  });

  it('generateTransactionHash uses account + externalId only', () => {
    const txA: Transaction = {
      date: new Date(2026, 3, 15),
      description: 'Stoneshaw',
      amount: -850,
      account: 'monzo-joint',
      type: 'expense',
      externalId: 'tx-dup-1',
      occurrence: 1,
    };
    const txB: Transaction = {
      ...txA,
      description: '78 HUNTERS SQ',
      occurrence: 2,
    };
    expect(generateTransactionHash(txA)).toBe(generateTransactionHash(txB));
  });

  it('falls back to date+amount+description key when Transaction ID is absent', () => {
    const noId = csvRow({
      Date: '15/04/2026',
      Name: 'Shop',
      Amount: '-3.50',
    });
    expect(generateRowKey(noId, monzoParser)).toContain('15/04/2026');
    expect(generateRowKey(noId, monzoParser).startsWith('externalId:')).toBe(false);
  });
});

describe('Monzo feed emitter — Stoneshaw alignment', () => {
  const stoneshawFeed: InternalFeedTransactions = {
    account: 'monzo-joint',
    window: { dateFrom: '2026-04-15', dateTo: '2026-04-15' },
    rows: [{
      date: '2026-04-15',
      description: '78 HUNTERS SQ',
      counterparty: 'Stoneshaw',
      amount: 850,
      currency: 'GBP',
      externalId: 'tl-ext-stoneshaw',
      reference: 'monzo-tx-stoneshaw',
    }],
  };

  it('emits Name=counterparty and Description=address line', () => {
    const csv = monzoParser.emitFeedTransactionsAsCsv?.(stoneshawFeed);
    expect(csv).toBeDefined();
    const records = parse(csv ?? '', {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as CSVRow[];
    expect(records[0]).toMatchObject({
      'Transaction ID': 'monzo-tx-stoneshaw',
      Name: 'Stoneshaw',
      Description: '78 HUNTERS SQ',
    });
  });

  it('round-trips to same description as native export', () => {
    const csv = monzoParser.emitFeedTransactionsAsCsv?.(stoneshawFeed) ?? '';
    const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as CSVRow[];
    const tx = monzoParser.transform(records[0], 'monzo-joint');
    expect(tx?.description).toBe('Stoneshaw');
    expect(tx?.externalId).toBe('monzo-tx-stoneshaw');
  });
});

describe('CSV + feed duplicate scenario', () => {
  it('merges export and feed rows with same Transaction ID into one ledger row key', () => {
    const nativeCsv =
      'Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Money Out,Money In\n' +
      'tx-merge-1,15/04/2026,,,Stoneshaw,,,850.00,GBP,850.00,GBP,,,,78 HUNTERS SQ,,,850.00\n';

    const feedRow: FeedTransactionRow = {
      date: '2026-04-15',
      description: '78 HUNTERS SQ',
      counterparty: 'Stoneshaw',
      amount: 850,
      currency: 'GBP',
      reference: 'tx-merge-1',
      externalId: 'tl-1',
    };
    const feedCsv = monzoParser.emitFeedTransactionsAsCsv?.({
      account: 'monzo-joint',
      window: { dateFrom: '2026-04-15', dateTo: '2026-04-15' },
      rows: [feedRow],
    }) ?? '';

    const nativeRecords = parse(nativeCsv, { columns: true, skip_empty_lines: true }) as CSVRow[];
    const feedRecords = parse(feedCsv, { columns: true, skip_empty_lines: true }) as CSVRow[];

    const merged = deduplicateRows([...nativeRecords, ...feedRecords], monzoParser);
    expect(merged).toHaveLength(1);
    expect(getMonzoColumnValue(merged[0], 'Transaction ID')).toBe('tx-merge-1');
  });
});
