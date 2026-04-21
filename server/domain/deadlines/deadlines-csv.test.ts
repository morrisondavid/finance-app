import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readDeadlinesFromCsvFile,
  writeDeadlinesToCsvFile,
  getDeadlinesCsvPath,
  DEADLINE_CSV_HEADERS,
} from './deadlines-csv.js';
import type { Deadline } from '../../../shared/api-contracts.js';

/**
 * Regression-lock the deadlines CSV layer. The whole mutation pipeline
 * (repo → CSV write → next reload) must round-trip every field
 * byte-for-byte or a user's notes/URL will silently drift on each edit.
 */
describe('deadlines CSV', () => {
  let tmpDir: string;
  let csvPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deadlines-csv-test-'));
    csvPath = getDeadlinesCsvPath(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns [] when the CSV file does not exist', () => {
    expect(readDeadlinesFromCsvFile(csvPath)).toEqual([]);
  });

  it('returns [] for an empty file', () => {
    fs.writeFileSync(csvPath, '');
    expect(readDeadlinesFromCsvFile(csvPath)).toEqual([]);
  });

  it('writes canonical header row first', () => {
    writeDeadlinesToCsvFile(csvPath, []);
    const content = fs.readFileSync(csvPath, 'utf8');
    expect(content.trim()).toBe(DEADLINE_CSV_HEADERS.join(','));
  });

  it('round-trips every field including nullable columns', () => {
    const rows: Deadline[] = [
      {
        id: 'ch-confirmation',
        type: 'companies-house',
        title: 'Companies House confirmation statement',
        dueDate: '2026-11-01',
        recurrence: 'annual',
        notes: 'File via WebFiling',
        url: 'https://example.com',
        completedDate: null,
        updatedAt: '2026-04-21T00:00:00.000Z',
      },
      {
        id: 'mot-2026',
        type: 'mot',
        title: 'Car MOT',
        dueDate: '2026-07-15',
        recurrence: 'annual',
        notes: null,
        url: null,
        completedDate: '2026-07-14',
        updatedAt: '2026-07-14T12:00:00.000Z',
      },
    ];
    writeDeadlinesToCsvFile(csvPath, rows);
    const read = readDeadlinesFromCsvFile(csvPath);
    expect(read).toEqual(rows);
  });

  it('escapes commas, quotes, and newlines in free-text fields', () => {
    const row: Deadline = {
      id: 'tricky-row',
      type: 'other',
      title: 'A, "tricky" title\nmultiline',
      dueDate: '2027-01-01',
      recurrence: 'one-off',
      notes: 'Line 1\nLine 2, with a "quote"',
      url: null,
      completedDate: null,
      updatedAt: '2026-04-21T00:00:00.000Z',
    };
    writeDeadlinesToCsvFile(csvPath, [row]);
    const [read] = readDeadlinesFromCsvFile(csvPath);
    expect(read.title).toBe(row.title);
    expect(read.notes).toBe(row.notes);
  });

  it('sorts rows by id for stable diffs', () => {
    const rows: Deadline[] = [
      buildDeadline({ id: 'z-last' }),
      buildDeadline({ id: 'a-first' }),
      buildDeadline({ id: 'm-middle' }),
    ];
    writeDeadlinesToCsvFile(csvPath, rows);
    const content = fs.readFileSync(csvPath, 'utf8').trim().split('\n').slice(1);
    expect(content.map(l => l.split(',')[0])).toEqual(['a-first', 'm-middle', 'z-last']);
  });

  it('drops rows with missing id, invalid due_date, or unknown type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const csv = [
      DEADLINE_CSV_HEADERS.join(','),
      ',other,no id,2026-01-01,one-off,,,,2026-04-21T00:00:00.000Z',
      'bad-date,other,Bad date,not-a-date,one-off,,,,2026-04-21T00:00:00.000Z',
      'bad-type,unknown-type,Bad type,2026-01-01,one-off,,,,2026-04-21T00:00:00.000Z',
      'good,other,Good row,2026-01-01,one-off,,,,2026-04-21T00:00:00.000Z',
    ].join('\n');
    fs.writeFileSync(csvPath, csv);
    const rows = readDeadlinesFromCsvFile(csvPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('good');
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('last row wins on duplicate id', () => {
    const csv = [
      DEADLINE_CSV_HEADERS.join(','),
      'dup,other,First version,2026-01-01,one-off,,,,2026-04-21T00:00:00.000Z',
      'dup,other,Second version,2026-02-01,one-off,,,,2026-04-21T00:00:00.000Z',
    ].join('\n');
    fs.writeFileSync(csvPath, csv);
    const rows = readDeadlinesFromCsvFile(csvPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Second version');
    expect(rows[0].dueDate).toBe('2026-02-01');
  });
});

function buildDeadline(overrides: Partial<Deadline>): Deadline {
  return {
    id: 'test',
    type: 'other',
    title: 'Test',
    dueDate: '2026-06-01',
    recurrence: 'one-off',
    notes: null,
    url: null,
    completedDate: null,
    updatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides,
  };
}
