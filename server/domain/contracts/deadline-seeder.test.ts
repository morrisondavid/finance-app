/**
 * Integration test for the contract-renewal deadline seeder.
 *
 * Runs against an in-memory SQLite DB + stub upstream registries so the
 * seeder's write path (via `upsertDeadline`) is exercised end-to-end
 * without touching the committed `clients/`, `autonize-it/`, or
 * `deadlines/` files on disk.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  createInMemoryTestDb,
  resetTestData,
  type TestDbHandles,
} from '../../db/test-harness/in-memory-db.js';

const harness: { current: TestDbHandles | null } = { current: null };

vi.mock('../../db/connection.js', () => ({
  getDb: () => {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.db;
  },
  get DEADLINES_DIR() {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.deadlinesDir;
  },
}));

import { buildContractRegistryFromData } from './registry.js';
import { parseContractRow } from './csv-io.js';
import {
  dcSowRow,
  dcSowInactiveRow,
  lfContractRow,
  lfFzcoContractRow,
  makeStubClients,
  makeStubCompanies,
  makeStubMasters,
} from './test-helpers.js';
import {
  syncContractRenewalDeadlines,
  contractRenewalDeadlineId,
  contractRenewalDeadlineTitle,
} from './deadline-seeder.js';
import { getAllDeadlines, markDeadlineDone } from '../../db/repositories/deadlines.js';

describe('syncContractRenewalDeadlines (integration)', () => {
  beforeAll(() => {
    harness.current = createInMemoryTestDb();
  });

  afterAll(() => {
    harness.current?.cleanup();
  });

  beforeEach(() => {
    if (harness.current) resetTestData(harness.current.db);
  });

  function runSeeder() {
    const clients = makeStubClients();
    const contracts = buildContractRegistryFromData(
      [parseContractRow(dcSowRow), parseContractRow(lfContractRow)],
      {
        clients,
        companies: makeStubCompanies(),
        masters: makeStubMasters(),
      },
    );
    return syncContractRenewalDeadlines({ contracts, clients });
  }

  it('first boot seeds one deadline per active contract with an end_date', () => {
    const seeded = runSeeder();
    expect([...seeded].sort()).toEqual([
      'contract-renewal-dc-sow-2026',
      'contract-renewal-lf-2026-mar',
    ]);

    const byId = new Map(getAllDeadlines().map(d => [d.id, d]));
    const lf = byId.get('contract-renewal-lf-2026-mar');
    expect(lf).toBeDefined();
    expect(lf!.type).toBe('contract-renewal');
    // lf-2026-mar: end_date 2026-03-31 minus 60 days = 2026-01-30
    expect(lf!.dueDate).toBe('2026-01-30');
    expect(lf!.title).toBe(
      'La Fosse renewal (La Fosse · 06 Jan 2026–31 Mar 2026)',
    );
    expect(lf!.completedDate).toBeNull();

    const dc = byId.get('contract-renewal-dc-sow-2026');
    // dc-sow-2026: end_date 2026-04-30 minus 60 days = 2026-03-01
    expect(dc!.dueDate).toBe('2026-03-01');
    expect(dc!.title).toBe(
      'Delta Capita renewal (Delta Capita · 01 Jan 2026–30 Apr 2026)',
    );
  });

  it('is idempotent across repeated calls', () => {
    runSeeder();
    const firstRun = getAllDeadlines().map(d => d.id).sort();
    runSeeder();
    runSeeder();
    const thirdRun = getAllDeadlines().map(d => d.id).sort();
    expect(thirdRun).toEqual(firstRun);
    expect(thirdRun).toHaveLength(2);
  });

  it('does not reopen a user-completed renewal deadline', () => {
    runSeeder();
    const marked = markDeadlineDone('contract-renewal-lf-2026-mar', '2026-01-15');
    expect(marked?.completedDate).toBe('2026-01-15');

    runSeeder();
    const afterReseed = getAllDeadlines().find(
      d => d.id === 'contract-renewal-lf-2026-mar',
    );
    expect(afterReseed?.completedDate).toBe('2026-01-15');
  });

  it('exposes id/title helpers that match the seeded rows', () => {
    const contract = parseContractRow(lfContractRow);
    expect(contractRenewalDeadlineId(contract)).toBe('contract-renewal-lf-2026-mar');
    expect(contractRenewalDeadlineTitle(contract, 'La Fosse')).toBe(
      'La Fosse renewal (La Fosse · 06 Jan 2026–31 Mar 2026)',
    );
  });

  it('skips inactive contracts — no renewal deadline seeded', () => {
    const clients = makeStubClients();
    const contracts = buildContractRegistryFromData(
      [parseContractRow(dcSowInactiveRow), parseContractRow(lfContractRow)],
      {
        clients,
        companies: makeStubCompanies(),
        masters: makeStubMasters(),
      },
    );
    const seeded = syncContractRenewalDeadlines({ contracts, clients });
    expect(seeded).toEqual(['contract-renewal-lf-2026-mar']);

    const byId = new Map(getAllDeadlines().map(d => [d.id, d]));
    expect(byId.has('contract-renewal-dc-sow-2025-prior')).toBe(false);
  });

  it('same client split across two issuing_entity_ids gets two distinct deadlines', () => {
    const clients = makeStubClients();
    const contracts = buildContractRegistryFromData(
      [parseContractRow(lfContractRow), parseContractRow(lfFzcoContractRow)],
      {
        clients,
        companies: makeStubCompanies(),
        masters: makeStubMasters(),
      },
    );
    const seeded = syncContractRenewalDeadlines({ contracts, clients });
    expect([...seeded].sort()).toEqual([
      'contract-renewal-lf-2026-apr',
      'contract-renewal-lf-2026-mar',
    ]);

    const byId = new Map(getAllDeadlines().map(d => [d.id, d]));
    const lfUk = byId.get('contract-renewal-lf-2026-mar');
    const lfFzco = byId.get('contract-renewal-lf-2026-apr');
    expect(lfUk!.dueDate).toBe('2026-01-30'); // 2026-03-31 − 60
    expect(lfFzco!.dueDate).toBe('2026-03-31'); // 2026-04-30 − 30
    expect(lfUk!.title).toBe(
      'La Fosse renewal (La Fosse · 06 Jan 2026–31 Mar 2026)',
    );
    expect(lfFzco!.title).toBe(
      'La Fosse renewal (La Fosse · 02 Mar 2026–30 Apr 2026)',
    );
  });
});
