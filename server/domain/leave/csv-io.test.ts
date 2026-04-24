/**
 * CSV round-trip tests for the leave domain.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  LEAVE_CSV_HEADERS,
  composeLeaveId,
  getLeaveCsvPath,
  parseLeaveRow,
  readLeaveCsvFile,
  serializeLeaveCsv,
  serializeLeaveRow,
  writeLeaveCsvFile,
} from './csv-io.js';
import {
  dcHolidayRow,
  dcPastSickRow,
  lfHolidayRow,
  mkTmpDir,
} from './test-helpers.js';

describe('composeLeaveId', () => {
  it('joins contract id + date with a hyphen', () => {
    expect(composeLeaveId('dc-sow-2026', '2026-05-04')).toBe('dc-sow-2026-2026-05-04');
  });
});

describe('parseLeaveRow', () => {
  it('parses a valid row', () => {
    const row = parseLeaveRow(dcHolidayRow);
    expect(row.id).toBe('dc-sow-2026-2026-05-04');
    expect(row.contract_id).toBe('dc-sow-2026');
    expect(row.date).toBe('2026-05-04');
    expect(row.type).toBe('holiday');
    expect(row.notes).toBeNull();
    expect(row.external_logged).toBe(false);
  });

  it('decodes notes=empty as null', () => {
    const row = parseLeaveRow(dcHolidayRow);
    expect(row.notes).toBeNull();
  });

  it('preserves a non-empty notes field', () => {
    const row = parseLeaveRow(dcPastSickRow);
    expect(row.notes).toBe('migraine');
  });

  it('refuses dates not in yyyy-mm-dd form', () => {
    expect(() => parseLeaveRow({ ...dcHolidayRow, date: '04/05/2026' })).toThrow(
      /must be yyyy-mm-dd/,
    );
  });

  it('refuses a non-boolean external_logged', () => {
    expect(() => parseLeaveRow({ ...dcHolidayRow, external_logged: 'yes' })).toThrow(
      /external_logged must be/,
    );
  });
});

describe('serializeLeaveRow', () => {
  it('produces the CSV_HEADERS field order', () => {
    const row = parseLeaveRow(dcHolidayRow);
    const line = serializeLeaveRow(row);
    expect(line.split(',')).toEqual([
      row.id,
      row.contract_id,
      row.date,
      row.type,
      '',
      'false',
      row.created_at,
      row.updated_at,
    ]);
  });

  it('quotes a notes field that contains a comma', () => {
    const row = parseLeaveRow({ ...dcPastSickRow, notes: 'out, bedridden' });
    const line = serializeLeaveRow(row);
    expect(line).toContain('"out, bedridden"');
  });
});

describe('serializeLeaveCsv', () => {
  it('writes header even when no rows', () => {
    const out = serializeLeaveCsv([]);
    expect(out).toBe(`${LEAVE_CSV_HEADERS.join(',')}\n`);
  });

  it('writes header then rows with trailing newline', () => {
    const rows = [parseLeaveRow(dcHolidayRow), parseLeaveRow(lfHolidayRow)];
    const out = serializeLeaveCsv(rows);
    const lines = out.trimEnd().split('\n');
    expect(lines[0]).toBe(LEAVE_CSV_HEADERS.join(','));
    expect(lines).toHaveLength(3);
    expect(out.endsWith('\n')).toBe(true);
  });
});

describe('round-trip read → parse → serialize → read', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('returns empty array when file is missing', () => {
    expect(readLeaveCsvFile(path.join(tmpDir, 'leave.csv'))).toEqual([]);
  });

  it('round-trips rows through the filesystem byte-for-byte', () => {
    const rows = [parseLeaveRow(dcHolidayRow), parseLeaveRow(dcPastSickRow)];
    writeLeaveCsvFile(getLeaveCsvPath(tmpDir), rows);
    const roundTripped = readLeaveCsvFile(getLeaveCsvPath(tmpDir));
    expect(roundTripped).toEqual(rows);
  });

  it('ignores rows with a blank id (CSV sentinel)', () => {
    const csv = [
      LEAVE_CSV_HEADERS.join(','),
      serializeLeaveRow(parseLeaveRow(dcHolidayRow)),
      ',,,,,,,',
    ].join('\n');
    fs.writeFileSync(getLeaveCsvPath(tmpDir), csv, 'utf8');
    const rows = readLeaveCsvFile(getLeaveCsvPath(tmpDir));
    expect(rows).toHaveLength(1);
  });
});
