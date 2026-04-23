/**
 * Gate logic for each index on the contracts registry.
 *
 * One describe block per index, plus an FK-validation section covering
 * the upstream-registry joins that happen at build time.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { buildContractRegistry } from './registry.js';
import { buildCompanyRegistryFromData } from '../company/registry.js';
import {
  mkTmpDir,
  makeStubClients,
  makeStubCompanies,
  makeStubMasters,
  seedCsv,
  dcSowRow,
  lfContractRow,
  lfExtensionRow,
  dcSowInactiveRow,
  rowFromHeaders,
} from './test-helpers.js';

function buildWithStubs(tmpDir: string) {
  return buildContractRegistry(tmpDir, {
    clients: makeStubClients(),
    companies: makeStubCompanies(),
    masters: makeStubMasters(),
  });
}

describe('contracts registry gates', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('returns an empty registry when the CSV file is missing', () => {
    const reg = buildWithStubs(tmpDir);
    expect(reg.all).toHaveLength(0);
    expect(reg.indexes.byId.size).toBe(0);
    expect(reg.indexes.byClient.size).toBe(0);
    expect(reg.indexes.byClientAndEntity.size).toBe(0);
    expect(reg.indexes.byMaster.size).toBe(0);
    expect(reg.indexes.active).toEqual([]);
  });

  it('preserves CSV order in `all`', () => {
    seedCsv(tmpDir, [dcSowRow, lfContractRow]);
    const reg = buildWithStubs(tmpDir);
    expect(reg.all.map(c => c.id)).toEqual(['dc-sow-2026', 'lf-2026-mar']);
  });

  it('refuses a CSV with duplicate contract ids', () => {
    seedCsv(tmpDir, [dcSowRow, dcSowRow]);
    expect(() => buildWithStubs(tmpDir)).toThrow(/duplicate/i);
  });

  describe('FK validation', () => {
    it('throws when client_id does not exist in clients registry', () => {
      seedCsv(tmpDir, [rowFromHeaders({ ...dcSowRow, client_id: 'ghost-client' })]);
      expect(() => buildWithStubs(tmpDir)).toThrow(/unknown client_id 'ghost-client'/);
    });

    it('throws when issuing_entity_id is absent from the injected company registry', () => {
      // `issuing_entity_id` is enum-narrowed to the known entity ids at
      // parse time, so the FK check bites when the injected company
      // registry is a *subset* that doesn't include the referenced id.
      seedCsv(tmpDir, [dcSowRow]);
      const clientsStub = makeStubClients();
      const companiesStub = buildCompanyRegistryFromData(
        makeStubCompanies().all.filter(c => c.id === 'autonize-it-fzco'),
      );
      expect(() =>
        buildContractRegistry(tmpDir, {
          clients: clientsStub,
          companies: companiesStub,
          masters: makeStubMasters(),
        }),
      ).toThrow(/unknown issuing_entity_id 'autonize-it-ltd'/);
    });

    it('throws when master_id does not exist in master-agreements', () => {
      seedCsv(tmpDir, [rowFromHeaders({ ...dcSowRow, master_id: 'ghost-master' })]);
      expect(() => buildWithStubs(tmpDir)).toThrow(/unknown master_id 'ghost-master'/);
    });

    it('throws when master.client_id does not match contract.client_id', () => {
      // dc-master-2025 is for delta-capita; claim it under la-fosse:
      seedCsv(tmpDir, [rowFromHeaders({
        ...dcSowRow,
        client_id: 'la-fosse',
        master_id: 'dc-master-2025',
      })]);
      expect(() => buildWithStubs(tmpDir)).toThrow(
        /master 'dc-master-2025' is for client 'delta-capita' but contract is for client 'la-fosse'/,
      );
    });

    it('throws when conduct_regs set on a non-UK issuing entity', () => {
      seedCsv(tmpDir, [rowFromHeaders({
        ...dcSowRow,
        issuing_entity_id: 'autonize-it-fzco',
        master_id: '',
        conduct_regs: 'opted-out',
        engagement_tax_status: '',
      })]);
      expect(() => buildWithStubs(tmpDir)).toThrow(/conduct_regs is UK-only/);
    });

    it('throws when engagement_tax_status set on a non-UK issuing entity', () => {
      seedCsv(tmpDir, [rowFromHeaders({
        ...dcSowRow,
        issuing_entity_id: 'autonize-it-fzco',
        master_id: '',
        conduct_regs: '',
        engagement_tax_status: 'outside-ir35',
      })]);
      expect(() => buildWithStubs(tmpDir)).toThrow(/engagement_tax_status is UK-only/);
    });
  });

  describe('indexes.byId', () => {
    it('gives O(1) access to each contract', () => {
      seedCsv(tmpDir, [dcSowRow, lfContractRow]);
      const reg = buildWithStubs(tmpDir);
      expect(reg.indexes.byId.get('dc-sow-2026')?.reference).toBe('DMORRISON02');
      expect(reg.indexes.byId.get('lf-2026-mar')?.reference).toBe('LAF-TEG-001');
      expect(reg.indexes.byId.get('dc-sow-2026')?.master_id).toBe('dc-master-2025');
      expect(reg.indexes.byId.get('lf-2026-mar')?.master_id).toBeNull();
    });
  });

  describe('indexes.byClient', () => {
    it('groups contracts by client_id', () => {
      seedCsv(tmpDir, [dcSowRow, lfContractRow, lfExtensionRow]);
      const reg = buildWithStubs(tmpDir);
      expect(reg.indexes.byClient.get('delta-capita')?.map(c => c.id)).toEqual(['dc-sow-2026']);
      expect(reg.indexes.byClient.get('la-fosse')?.map(c => c.id)).toEqual([
        'lf-2026-mar',
        'lf-extension-1',
      ]);
    });

    it('orders contracts within a client by start_date ascending', () => {
      seedCsv(tmpDir, [lfExtensionRow, lfContractRow]);
      const reg = buildWithStubs(tmpDir);
      const series = reg.indexes.byClient.get('la-fosse') ?? [];
      expect(series.map(c => c.start_date)).toEqual(['2026-01-06', '2026-04-01']);
    });
  });

  describe('indexes.byClientAndEntity', () => {
    it('partitions contracts by (client_id, issuing_entity_id)', () => {
      seedCsv(tmpDir, [dcSowRow, lfContractRow]);
      const reg = buildWithStubs(tmpDir);
      expect(reg.indexes.byClientAndEntity.get('delta-capita|autonize-it-ltd')).toHaveLength(1);
      expect(reg.indexes.byClientAndEntity.get('la-fosse|autonize-it-ltd')).toHaveLength(1);
    });

    it('places extensions after their parent SOW within the same series', () => {
      seedCsv(tmpDir, [lfExtensionRow, lfContractRow]);
      const reg = buildWithStubs(tmpDir);
      const series = reg.indexes.byClientAndEntity.get('la-fosse|autonize-it-ltd') ?? [];
      expect(series.map(c => c.id)).toEqual(['lf-2026-mar', 'lf-extension-1']);
    });
  });

  describe('indexes.byMaster', () => {
    it('contains only contracts with a non-null master_id', () => {
      seedCsv(tmpDir, [dcSowRow, lfContractRow]);
      const reg = buildWithStubs(tmpDir);
      expect(reg.indexes.byMaster.get('dc-master-2025')?.map(c => c.id)).toEqual(['dc-sow-2026']);
      expect(reg.indexes.byMaster.size).toBe(1);
    });

    it('omits contracts with null master_id', () => {
      seedCsv(tmpDir, [lfContractRow]);
      const reg = buildWithStubs(tmpDir);
      expect(reg.indexes.byMaster.size).toBe(0);
    });
  });

  describe('indexes.active', () => {
    it('includes contracts with active === true', () => {
      seedCsv(tmpDir, [dcSowRow, dcSowInactiveRow]);
      const reg = buildWithStubs(tmpDir);
      expect(reg.indexes.active.map(c => c.id)).toEqual(['dc-sow-2026']);
    });
  });
});
