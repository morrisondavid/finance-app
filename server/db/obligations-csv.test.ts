import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readManualObligationsFromCsvFile,
  writeManualObligationsToCsvFile,
  ensureObligationsCsvWithHeader,
  type ManualObligationCsvRow,
} from './obligations-csv.js';

describe('obligations-csv', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obligations-csv-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function csvPath(): string {
    return path.join(tmpDir, 'manual-obligations.csv');
  }

  describe('round-trip', () => {
    it('writes and reads rows back identically', () => {
      const rows: ManualObligationCsvRow[] = [
        {
          id: 'test-1', type: 'vat', name: 'VAT Q1', entity: 'HMRC',
          recurrence: 'quarterly', expectedAmount: 5000, dueDate: '2025-03-07',
          status: 'pending', notes: null, personId: null,
        },
        {
          id: 'test-2', type: 'self-assessment', name: 'SA 2025/26', entity: 'HMRC',
          recurrence: 'annual', expectedAmount: 11430, dueDate: '2026-01-31',
          status: 'pending', notes: 'Accountant figure', personId: 'david',
        },
      ];
      const fp = csvPath();
      writeManualObligationsToCsvFile(fp, rows);
      const result = readManualObligationsFromCsvFile(fp);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('test-1');
      expect(result[0].expectedAmount).toBe(5000);
      expect(result[0].personId).toBeNull();
      expect(result[1].notes).toBe('Accountant figure');
      expect(result[1].personId).toBe('david');
    });
  });

  describe('empty / missing file', () => {
    it('returns empty array for non-existent file', () => {
      expect(readManualObligationsFromCsvFile(csvPath())).toEqual([]);
    });

    it('returns empty array for empty file', () => {
      fs.writeFileSync(csvPath(), '', 'utf8');
      expect(readManualObligationsFromCsvFile(csvPath())).toEqual([]);
    });

    it('returns empty array for header-only file', () => {
      ensureObligationsCsvWithHeader(csvPath());
      expect(readManualObligationsFromCsvFile(csvPath())).toEqual([]);
    });
  });

  describe('malformed rows', () => {
    it('skips rows with missing required fields', () => {
      const content = `id,type,name,entity,recurrence,expected_amount,due_date,status,notes,person_id
good-1,vat,VAT Q1,HMRC,quarterly,1000,2025-03-07,pending,,
,vat,missing id,HMRC,quarterly,500,,pending,,
good-2,loan,Loan,Barclays,monthly,200,,pending,,
`;
      fs.writeFileSync(csvPath(), content, 'utf8');
      const result = readManualObligationsFromCsvFile(csvPath());
      expect(result).toHaveLength(2);
      expect(result.map(r => r.id)).toEqual(['good-1', 'good-2']);
    });
  });

  describe('atomic write', () => {
    it('does not leave .tmp file on success', () => {
      const fp = csvPath();
      writeManualObligationsToCsvFile(fp, [
        { id: 'x', type: 'other', name: 'Test', entity: 'E', recurrence: 'one-off', expectedAmount: null, dueDate: null, status: 'pending', notes: null, personId: null },
      ]);
      expect(fs.existsSync(`${fp}.tmp`)).toBe(false);
      expect(fs.existsSync(fp)).toBe(true);
    });
  });
});
