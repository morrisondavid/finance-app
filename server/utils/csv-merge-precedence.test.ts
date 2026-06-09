import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import type { BankParser, CSVRow, ValidationResult } from '../types.js';

const { mockParser } = vi.hoisted(() => {
  const parser: BankParser = {
  columns: 'auto',
  dateColumn: 'Date',
  amountColumn: 'Amount',
  descriptionColumn: 'Description',
  headers: ['Date', 'Amount', 'Description'] as const,
  requiredHeaders: ['Date', 'Amount'] as const,
  parseOptions: {},
  preprocess(content: string): string {
    return content;
  },
  parseDate(dateStr: string): Date | null {
    const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
    }
    return null;
  },
  extractFilenameDate(): string | null {
    return null;
  },
  validateHeaders(): ValidationResult {
    return { valid: true };
  },
  transform() {
    return null;
  },
  };
  return { mockParser: parser };
});

vi.mock('../parsers/index.js', () => ({
  PARSERS: { test: mockParser },
}));

import {
  partitionCSVFile,
  parseCSVContent,
  mergeMonthRows,
  filterRowsToUncoveredDates,
  getCoveredIsoDates,
  resolveMergeStrategy,
  type FileSystem,
} from './csv-partitioner.js';

describe('resolveMergeStrategy', () => {
  it('uses row dedupe for feed sources', () => {
    expect(resolveMergeStrategy('feed_2026-06-06_2026-06-08.csv')).toBe('row-dedupe');
  });

  it('uses row dedupe for normalized monthly filenames', () => {
    expect(resolveMergeStrategy('2026-04_transactions_barclays-current.csv')).toBe('row-dedupe');
  });

  it('uses row dedupe when source filename is omitted', () => {
    expect(resolveMergeStrategy(undefined)).toBe('row-dedupe');
  });

  it('uses date precedence for manual uploads', () => {
    expect(resolveMergeStrategy('data (2).csv')).toBe('date-precedence');
  });
});

describe('mergeMonthRows — date precedence', () => {
  const existing: CSVRow[] = [
    { Date: '01/04/2026', Amount: '13200.00', Description: 'DELTA CAPITA LIM * TFR' },
    { Date: '07/04/2026', Amount: '-17.83', Description: 'CAREEM FOOD ON 06 APR BDC' },
  ];

  it('imports only rows on dates not already covered', () => {
    const incoming: CSVRow[] = [
      { Date: '01/04/2026', Amount: '13200.00', Description: 'DELTA CAPITA LIM * 117213*DC-009 * TFR' },
      { Date: '13/04/2026', Amount: '-200.00', Description: 'HEENA TAILOR AUTONIZE IT FT' },
    ];
    const merged = mergeMonthRows(existing, incoming, mockParser, 'date-precedence');
    expect(merged).toHaveLength(3);
    expect(merged.map(r => r.Description)).toEqual([
      'DELTA CAPITA LIM * TFR',
      'CAREEM FOOD ON 06 APR BDC',
      'HEENA TAILOR AUTONIZE IT FT',
    ]);
  });

  it('keeps Heena and David same-day same-amount rows separate via occurrence', () => {
    const sameDay: CSVRow[] = [
      { Date: '01/06/2026', Amount: '-1900.00', Description: 'HEENA TAILOR AUTONIZEIT STO' },
      { Date: '01/06/2026', Amount: '-1900.00', Description: 'DAVID MORRISON DIVIDENDS STO' },
    ];
    const covered = getCoveredIsoDates([], mockParser);
    const filtered = filterRowsToUncoveredDates(sameDay, mockParser, covered);
    const merged = mergeMonthRows([], filtered, mockParser, 'date-precedence');
    expect(merged).toHaveLength(2);
    const descriptions = merged.map(r => r.Description).sort();
    expect(descriptions).toContain('HEENA TAILOR AUTONIZEIT STO');
    expect(descriptions).toContain('DAVID MORRISON DIVIDENDS STO');
  });
});

describe('partitionCSVFile — merge precedence integration', () => {
  let mockFs: FileSystem;
  const writtenFiles = new Map<string, string>();

  beforeEach(() => {
    writtenFiles.clear();
    mockFs = {
      readFile: vi.fn(),
      writeFile: vi.fn((filePath: string, content: string) => {
        writtenFiles.set(filePath, content);
      }),
      deleteFile: vi.fn(),
      ensureDir: vi.fn(),
      exists: vi.fn().mockReturnValue(false),
    };
  });

  it('merges feed overlap with row dedupe (identical memo collapses)', () => {
    const existing = `Date,Amount,Description
08/06/2026,-5924.81,HMRC VAT SOUTHEND`;

    (mockFs.exists as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('2026-06_transactions_test.csv'),
    );
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      if (p.endsWith('2026-06_transactions_test.csv')) return existing;
      return `Date,Amount,Description
08/06/2026,-5924.81,HMRC VAT SOUTHEND`;
    });

    partitionCSVFile(
      '/data/test/feed_2026-06-06_2026-06-08.csv',
      'test',
      mockFs,
      { sourceFilename: 'feed_2026-06-06_2026-06-08.csv' },
    );

    const out = writtenFiles.get(path.join('/data/test', '2026-06_transactions_test.csv'));
    expect(out).toBeDefined();
    const rows = parseCSVContent(out!);
    expect(rows).toHaveLength(1);
  });

  it('merges manual upload with date precedence (skips covered dates)', () => {
    const existing = `Date,Amount,Description
01/04/2026,13200.00,DELTA CAPITA LIM * TFR
07/04/2026,-17.83,CAREEM FOOD ON 06 APR BDC`;

    (mockFs.exists as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('2026-04_transactions_test.csv'),
    );
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      if (p.endsWith('2026-04_transactions_test.csv')) return existing;
      return `Date,Amount,Description
01/04/2026,13200.00,DELTA CAPITA LIM * 117213*DC-009 * TFR
13/04/2026,-200.00,HEENA TAILOR AUTONIZE IT FT`;
    });

    partitionCSVFile(
      '/data/test/data (2).csv',
      'test',
      mockFs,
      { sourceFilename: 'data (2).csv' },
    );

    const out = writtenFiles.get(path.join('/data/test', '2026-04_transactions_test.csv'));
    expect(out).toBeDefined();
    const rows = parseCSVContent(out!);
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.Description)).toEqual([
      'DELTA CAPITA LIM * TFR',
      'CAREEM FOOD ON 06 APR BDC',
      'HEENA TAILOR AUTONIZE IT FT',
    ]);
  });
});
