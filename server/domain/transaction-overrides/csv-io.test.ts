import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  OVERRIDES_CSV_FILENAME,
  parseOverridesCsv,
  readOverridesCsvFile,
  serializeOverridesCsv,
  writeOverridesCsvFile,
} from './csv-io.js';
import type { TransactionCategoryOverrideRow } from '../../../shared/api-contracts.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overrides-csv-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function fixturePath(): string {
  return path.join(tmpDir, OVERRIDES_CSV_FILENAME);
}

describe('parseOverridesCsv', () => {
  it('parses a well-formed row with notes', () => {
    const rows = parseOverridesCsv(
      `hash,category,notes,classified_at\nabc123,Inter-company Loan,Wise->EI,2026-04-21\n`,
    );
    expect(rows).toEqual<TransactionCategoryOverrideRow[]>([
      {
        hash: 'abc123',
        category: 'Inter-company Loan',
        notes: 'Wise->EI',
        classified_at: '2026-04-21',
      },
    ]);
  });

  it('rehydrates an empty notes cell to null', () => {
    const rows = parseOverridesCsv(
      `hash,category,notes,classified_at\nabc123,Inter-company Loan,,2026-04-21\n`,
    );
    expect(rows[0].notes).toBeNull();
  });

  it('returns an empty array for a header-only file', () => {
    const rows = parseOverridesCsv(`hash,category,notes,classified_at\n`);
    expect(rows).toEqual([]);
  });

  it('rejects a row whose category is not in CATEGORY_NAMES', () => {
    expect(() =>
      parseOverridesCsv(
        `hash,category,notes,classified_at\nabc,Tesla Incorporated,,2026-04-21\n`,
      ),
    ).toThrow(/category/);
  });

  it('rejects a row whose classified_at is not an ISO date', () => {
    expect(() =>
      parseOverridesCsv(
        `hash,category,notes,classified_at\nabc,Inter-company Loan,,21/04/2026\n`,
      ),
    ).toThrow(/classified_at/);
  });

  it('rejects a row with an empty hash (CSV-level integrity)', () => {
    expect(() =>
      parseOverridesCsv(
        `hash,category,notes,classified_at\n,Inter-company Loan,,2026-04-21\n`,
      ),
    ).toThrow(/hash/);
  });

  it('parses notes containing commas, quotes, and newlines (CSV escaping works)', () => {
    const tricky = 'note with, comma and "quote" and\nnewline';
    const serialized = serializeOverridesCsv([
      {
        hash: 'abc',
        category: 'Inter-company Loan',
        notes: tricky,
        classified_at: '2026-04-21',
      },
    ]);
    const parsed = parseOverridesCsv(serialized);
    expect(parsed[0].notes).toBe(tricky);
  });

  it('parses duplicate hashes in file order (last-write-wins lives in registry, not parser)', () => {
    const rows = parseOverridesCsv(
      `hash,category,notes,classified_at\nabc,Inter-company Loan,,2026-04-20\nabc,Capital Contribution,,2026-04-21\n`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].category).toBe('Inter-company Loan');
    expect(rows[1].category).toBe('Capital Contribution');
  });
});

describe('readOverridesCsvFile', () => {
  it('returns null when the file does not exist', () => {
    expect(readOverridesCsvFile(fixturePath())).toBeNull();
  });

  it('returns an empty array for a header-only file', () => {
    fs.writeFileSync(fixturePath(), 'hash,category,notes,classified_at\n');
    expect(readOverridesCsvFile(fixturePath())).toEqual([]);
  });

  it('round-trips write then read byte-for-byte equivalent data', () => {
    const rows: TransactionCategoryOverrideRow[] = [
      {
        hash: 'abc123',
        category: 'Inter-company Loan',
        notes: 'Wise -> EI',
        classified_at: '2026-04-21',
      },
      {
        hash: 'def456',
        category: 'Inter-company False Positive',
        notes: null,
        classified_at: '2026-04-21',
      },
    ];
    writeOverridesCsvFile(fixturePath(), rows);
    expect(readOverridesCsvFile(fixturePath())).toEqual(rows);
  });
});

describe('writeOverridesCsvFile', () => {
  it('writes a header-only file when rows is empty', () => {
    writeOverridesCsvFile(fixturePath(), []);
    const text = fs.readFileSync(fixturePath(), 'utf8');
    expect(text).toBe('hash,category,notes,classified_at\n');
  });

  it('creates the directory if it does not exist', () => {
    const nested = path.join(tmpDir, 'nested', 'sub', OVERRIDES_CSV_FILENAME);
    writeOverridesCsvFile(nested, []);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('does not leave a partial .tmp file on success', () => {
    writeOverridesCsvFile(fixturePath(), [
      {
        hash: 'abc',
        category: 'Inter-company Loan',
        notes: null,
        classified_at: '2026-04-21',
      },
    ]);
    const siblings = fs.readdirSync(tmpDir);
    expect(siblings.some(f => f.endsWith('.tmp'))).toBe(false);
  });
});
