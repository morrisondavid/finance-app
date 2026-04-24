/**
 * Cross-index invariants for the invoices registry.
 *
 * Internal consistency: indexes derived from the same source must
 * agree on membership; `byContractId` must be sorted by
 * `invoice_date` ascending because `latestInvoiceForContract` and
 * the Phase 2 sequence generator rely on that ordering.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { buildInvoiceRegistry, buildInvoiceRegistryFromData } from './registry.js';
import {
  mkTmpDir,
  seedCsv,
  dcInvoice001,
  dcInvoice002,
  fzcoInvoice001,
  rowFromHeaders,
} from './test-helpers.js';
import { parseInvoiceRow } from './csv-io.js';

describe('invoices registry invariants', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('byId covers exactly the invoices in `all`', () => {
    seedCsv(tmpDir, [dcInvoice001, dcInvoice002, fzcoInvoice001]);
    const reg = buildInvoiceRegistry(tmpDir);
    expect(reg.indexes.byId.size).toBe(reg.all.length);
    for (const inv of reg.all) {
      expect(reg.indexes.byId.get(inv.id)).toBe(inv);
    }
  });

  it('throws on duplicate ids', () => {
    const dup = rowFromHeaders({ ...dcInvoice001 }); // same id as dcInvoice001
    expect(() =>
      buildInvoiceRegistryFromData([dcInvoice001, dup].map(parseInvoiceRow)),
    ).toThrow(/duplicate key 'DC-001'/);
  });

  it('byContractId lists each contract’s invoices sorted by invoice_date asc', () => {
    // Seed in reverse date order to prove the sort is applied, not
    // accidentally inherited from CSV order.
    seedCsv(tmpDir, [dcInvoice002, dcInvoice001]);
    const reg = buildInvoiceRegistry(tmpDir);
    const rows = reg.indexes.byContractId.get('dc-sow-2025-jun') ?? [];
    expect(rows.map(r => r.id)).toEqual(['DC-001', 'DC-002']);
    expect(rows.map(r => r.invoice_date)).toEqual(['2025-07-09', '2025-08-11']);
  });

  it('byIssuingEntityId union covers every row', () => {
    seedCsv(tmpDir, [dcInvoice001, dcInvoice002, fzcoInvoice001]);
    const reg = buildInvoiceRegistry(tmpDir);
    const union: string[] = [];
    for (const rows of reg.indexes.byIssuingEntityId.values()) {
      for (const inv of rows) union.push(inv.id);
    }
    expect(union.sort()).toEqual(reg.all.map(i => i.id).sort());
  });

  it('byStatus union covers every row', () => {
    seedCsv(tmpDir, [dcInvoice001, dcInvoice002, fzcoInvoice001]);
    const reg = buildInvoiceRegistry(tmpDir);
    const union: string[] = [];
    for (const rows of reg.indexes.byStatus.values()) {
      for (const inv of rows) union.push(inv.id);
    }
    expect(union.sort()).toEqual(reg.all.map(i => i.id).sort());
  });

  it('buildInvoiceRegistryFromData([]) produces an empty but structurally valid registry', () => {
    const reg = buildInvoiceRegistryFromData([]);
    expect(reg.all).toEqual([]);
    expect(reg.indexes.byId.size).toBe(0);
    expect(reg.indexes.byContractId.size).toBe(0);
    expect(reg.indexes.byIssuingEntityId.size).toBe(0);
    expect(reg.indexes.byStatus.size).toBe(0);
  });
});
