/**
 * Loader lifecycle + correctness tests for master-agreements.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  __resetMasterAgreementsForTests,
  invalidateMasterAgreements,
  loadMasterAgreements,
} from './loader.js';
import { mkTmpDir, dcMasterRow, seedCsv } from './test-helpers.js';

describe('loadMasterAgreements', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkTmpDir();
    __resetMasterAgreementsForTests();
  });

  afterEach(() => {
    __resetMasterAgreementsForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns [] when the CSV file is missing', () => {
    expect(loadMasterAgreements(tmpDir)).toEqual([]);
  });

  it('loads rows in CSV order', () => {
    seedCsv(tmpDir, [dcMasterRow]);
    const rows = loadMasterAgreements(tmpDir);
    expect(rows.map(m => m.id)).toEqual(['dc-master-2025']);
  });

  it('memoises — repeated calls return the same reference', () => {
    seedCsv(tmpDir, [dcMasterRow]);
    const first = loadMasterAgreements(tmpDir);
    const second = loadMasterAgreements(tmpDir);
    expect(first).toBe(second);
  });

  it('invalidate busts the cache', () => {
    seedCsv(tmpDir, [dcMasterRow]);
    const first = loadMasterAgreements(tmpDir);
    invalidateMasterAgreements();
    const second = loadMasterAgreements(tmpDir);
    expect(first).not.toBe(second);
    expect(first.length).toBe(second.length);
  });

  it('__resetMasterAgreementsForTests(override) installs an explicit fixture', () => {
    const fixture = [
      {
        id: 'fx',
        client_id: 'delta-capita' as const,
        reference: 'FX',
        start_date: '2026-01-01',
        end_date: null,
        company_notice_weeks: 1,
        supplier_notice_weeks: 1,
        jurisdiction: 'England',
        signed_at: '2026-01-01',
        docusign_envelope: null,
        active: true,
        updated_at: null,
      },
    ];
    __resetMasterAgreementsForTests(fixture);
    expect(loadMasterAgreements()).toBe(fixture);
  });
});
