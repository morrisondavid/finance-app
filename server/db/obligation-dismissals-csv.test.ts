import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readObligationDismissalsFromCsvFile,
  writeObligationDismissalsToCsvFile,
  ensureObligationDismissalsCsvWithHeader,
  type ObligationDismissalCsvRow,
} from './obligation-dismissals-csv.js';

describe('obligation-dismissals-csv', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obligation-dismissals-csv-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function csvPath(): string {
    return path.join(tmpDir, 'obligation-dismissals.csv');
  }

  describe('round-trip', () => {
    it('writes and reads rows back identically', () => {
      const rows: ObligationDismissalCsvRow[] = [
        {
          obligationId: 'auto-sa-david-2026-01-31',
          reason: 'Non-resident in Dubai',
          dismissedAt: '2026-04-10T12:00:00.000Z',
        },
        {
          obligationId: 'auto-vat-2025-05-01',
          reason: null,
          dismissedAt: '2026-04-11T09:30:00.000Z',
        },
      ];
      const fp = csvPath();
      writeObligationDismissalsToCsvFile(fp, rows);
      const result = readObligationDismissalsFromCsvFile(fp);

      expect(result).toHaveLength(2);
      const david = result.find(r => r.obligationId === 'auto-sa-david-2026-01-31');
      const vat = result.find(r => r.obligationId === 'auto-vat-2025-05-01');
      expect(david?.reason).toBe('Non-resident in Dubai');
      expect(david?.dismissedAt).toBe('2026-04-10T12:00:00.000Z');
      expect(vat?.reason).toBeNull();
    });

    it('escapes commas and quotes in reason text', () => {
      const rows: ObligationDismissalCsvRow[] = [
        {
          obligationId: 'auto-sa-heena-2026-01-31',
          reason: 'Won\'t owe anything, expected nil return',
          dismissedAt: '2026-04-12T10:00:00.000Z',
        },
      ];
      const fp = csvPath();
      writeObligationDismissalsToCsvFile(fp, rows);
      const result = readObligationDismissalsFromCsvFile(fp);
      expect(result[0].reason).toBe('Won\'t owe anything, expected nil return');
    });
  });

  describe('empty / missing file', () => {
    it('returns empty array for non-existent file', () => {
      expect(readObligationDismissalsFromCsvFile(csvPath())).toEqual([]);
    });

    it('returns empty array for empty file', () => {
      fs.writeFileSync(csvPath(), '', 'utf8');
      expect(readObligationDismissalsFromCsvFile(csvPath())).toEqual([]);
    });

    it('returns empty array for header-only file', () => {
      ensureObligationDismissalsCsvWithHeader(csvPath());
      expect(readObligationDismissalsFromCsvFile(csvPath())).toEqual([]);
    });
  });

  describe('malformed rows', () => {
    it('skips rows missing obligation_id', () => {
      const content = `obligation_id,reason,dismissed_at
auto-sa-david-2026-01-31,ok,2026-04-10T12:00:00.000Z
,orphan,2026-04-10T12:00:00.000Z
auto-vat-2025-05-01,,2026-04-11T09:30:00.000Z
`;
      fs.writeFileSync(csvPath(), content, 'utf8');
      const result = readObligationDismissalsFromCsvFile(csvPath());
      expect(result.map(r => r.obligationId)).toEqual([
        'auto-sa-david-2026-01-31',
        'auto-vat-2025-05-01',
      ]);
    });
  });

  describe('atomic write', () => {
    it('does not leave .tmp file on success', () => {
      const fp = csvPath();
      writeObligationDismissalsToCsvFile(fp, [
        { obligationId: 'auto-sa-david-2026-01-31', reason: null, dismissedAt: '2026-04-10T12:00:00.000Z' },
      ]);
      expect(fs.existsSync(`${fp}.tmp`)).toBe(false);
      expect(fs.existsSync(fp)).toBe(true);
    });
  });
});
