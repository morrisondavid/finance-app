/**
 * Schema coherence for the company registry.
 *
 * Every row loaded by the production CSV path must parse against
 * `CompanySchema`. Rows produced by the seeded helpers must also parse
 * — a safety net against the test helpers drifting from the canonical
 * schema.
 */

import { describe, it, expect } from 'vitest';
import { CompanySchema } from './schema.js';
import { buildCompanyRegistry } from './registry.js';
import { mkTmpDir, seedCsv, ukRow, uaeRow } from './test-helpers.js';
import fs from 'fs';

describe('company schema', () => {
  it('parses every row committed in autonize-it/company.csv', () => {
    const reg = buildCompanyRegistry();
    for (const c of reg.all) {
      expect(() => CompanySchema.parse(c)).not.toThrow();
    }
  });

  it('parses seeded helper rows (ukRow, uaeRow)', () => {
    const tmp = mkTmpDir();
    try {
      seedCsv(tmp, [ukRow, uaeRow]);
      const reg = buildCompanyRegistry(tmp);
      expect(reg.all).toHaveLength(2);
      for (const c of reg.all) {
        expect(() => CompanySchema.parse(c)).not.toThrow();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
