/**
 * Cross-index invariants for the clients registry.
 *
 * Internal consistency: indexes derived from the same source must
 * agree on membership.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { buildClientRegistry } from './registry.js';
import {
  mkTmpDir,
  seedCsv,
  directRow,
  agencyRow,
  agencyInactiveRow,
} from './test-helpers.js';

describe('clients registry invariants', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('byId covers exactly the clients in `all`', () => {
    seedCsv(tmpDir, [directRow, agencyRow]);
    const reg = buildClientRegistry(tmpDir);
    expect(reg.indexes.byId.size).toBe(reg.all.length);
    for (const c of reg.all) {
      expect(reg.indexes.byId.get(c.id)).toBe(c);
    }
  });

  it('byKind union covers every row in `all`', () => {
    seedCsv(tmpDir, [directRow, agencyRow]);
    const reg = buildClientRegistry(tmpDir);
    const union: string[] = [];
    for (const rows of reg.indexes.byKind.values()) {
      for (const c of rows) union.push(c.id);
    }
    expect(union.sort()).toEqual(reg.all.map(c => c.id).sort());
  });

  it('active ⊆ all', () => {
    seedCsv(tmpDir, [directRow, agencyInactiveRow]);
    const reg = buildClientRegistry(tmpDir);
    const allIds = new Set(reg.all.map(c => c.id));
    for (const c of reg.indexes.active) {
      expect(allIds.has(c.id)).toBe(true);
    }
  });

  it('every active client has active === true', () => {
    seedCsv(tmpDir, [directRow, agencyInactiveRow]);
    const reg = buildClientRegistry(tmpDir);
    for (const c of reg.indexes.active) {
      expect(c.active).toBe(true);
    }
  });

  it('every direct client has its end-client block fully nulled', () => {
    seedCsv(tmpDir, [directRow, agencyRow]);
    const reg = buildClientRegistry(tmpDir);
    const directs = reg.indexes.byKind.get('direct') ?? [];
    for (const c of directs) {
      if (c.kind === 'direct') {
        expect(c.end_client_legal_name).toBeNull();
        expect(c.end_client_address).toBeNull();
        expect(c.end_client_primary_contact_name).toBeNull();
        expect(c.end_client_primary_contact_email).toBeNull();
        expect(c.end_client_secondary_contact_name).toBeNull();
        expect(c.end_client_secondary_contact_email).toBeNull();
      }
    }
  });

  it('every agency client has legal_name + address populated on the end-client block', () => {
    seedCsv(tmpDir, [directRow, agencyRow]);
    const reg = buildClientRegistry(tmpDir);
    const agencies = reg.indexes.byKind.get('agency') ?? [];
    for (const c of agencies) {
      if (c.kind === 'agency') {
        expect(c.end_client_legal_name.length).toBeGreaterThan(0);
        expect(c.end_client_address.length).toBeGreaterThan(0);
      }
    }
  });
});
