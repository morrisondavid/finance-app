/**
 * Query purity + behaviour for the contracts domain.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  allContracts,
  findContractById,
  findContractForTransaction,
  listCurrentContracts,
  listContractsForForecast,
  listContractsByClient,
  upsertContract,
} from './queries.js';
import { makeTestContractRegistry } from './fixtures.js';
import { parseContractRow, readContractsCsvFile, getContractsCsvPath } from './csv-io.js';
import {
  mkTmpDir,
  makeStubClients,
  makeStubCompanies,
  makeStubMasters,
  dcSowRow,
  lfContractRow,
  lfExtensionRow,
  lfFzcoContractRow,
  dcSowExpiredRow,
} from './test-helpers.js';

const clients = makeStubClients();
const companies = makeStubCompanies();
const masters = makeStubMasters();

const full = makeTestContractRegistry({
  contracts: [
    parseContractRow(dcSowRow),
    parseContractRow(lfContractRow),
    parseContractRow(lfExtensionRow),
  ],
  clients,
  companies,
  masters,
});

const dcOnly = makeTestContractRegistry({
  contracts: [parseContractRow(dcSowRow)],
  clients,
  companies,
  masters,
});

const withExpired = makeTestContractRegistry({
  contracts: [parseContractRow(dcSowRow), parseContractRow(dcSowExpiredRow)],
  clients,
  companies,
  masters,
});

describe('allContracts', () => {
  it('returns the canonical ordered list', () => {
    expect(allContracts(full).map(c => c.id)).toEqual([
      'dc-sow-2026',
      'lf-2026-mar',
      'lf-extension-1',
    ]);
  });
});

describe('findContractById', () => {
  it('returns the matching contract', () => {
    expect(findContractById('dc-sow-2026', full)?.client_id).toBe('delta-capita');
  });

  it('returns null for unknown ids', () => {
    expect(findContractById('missing', full)).toBeNull();
  });
});

describe('listContractsByClient', () => {
  it('returns every contract for a client, ordered by start_date', () => {
    expect(listContractsByClient('la-fosse', full).map(c => c.id)).toEqual([
      'lf-2026-mar',
      'lf-extension-1',
    ]);
  });

  it('returns an empty list for unknown clients', () => {
    expect(listContractsByClient('nobody', full)).toEqual([]);
  });
});

describe('listCurrentContracts', () => {
  it('excludes expired contracts', () => {
    expect(listCurrentContracts('2026-04-15', withExpired).map(c => c.id)).toEqual(['dc-sow-2026']);
  });
});

describe('listContractsForForecast', () => {
  // dc-sow-2026 ends 2026-04-30 (monthly, 30-day terms): its final payment
  // could land up to 2026-04-30 + 30 + 7-day buffer = 2026-06-06.
  it('includes a current contract', () => {
    expect(listContractsForForecast('2026-04-15', dcOnly).map(c => c.id)).toEqual(['dc-sow-2026']);
  });

  it('keeps a recently-ended contract while its final payment is still outstanding', () => {
    expect(listContractsForForecast('2026-05-15', dcOnly).map(c => c.id)).toEqual(['dc-sow-2026']);
  });

  it('drops a contract once past its last expected payment date', () => {
    expect(listContractsForForecast('2026-06-10', dcOnly)).toEqual([]);
  });

  it('excludes a long-ended contract that is already settled', () => {
    // dc-sow-2025-prior ended 2026-03-01; by 2026-04-15 its trailing window
    // (to 2026-04-07) has closed, so only the current SOW remains.
    expect(listContractsForForecast('2026-04-15', withExpired).map(c => c.id)).toEqual(['dc-sow-2026']);
  });
});

describe('findContractForTransaction', () => {
  it('returns the DC SOW for a date inside its range', () => {
    const c = findContractForTransaction(
      { clientId: 'delta-capita', issuingEntityId: 'autonize-it-ltd', date: '2026-04-15' },
      full,
    );
    expect(c?.id).toBe('dc-sow-2026');
  });

  it('returns null for a date before any contract starts', () => {
    const c = findContractForTransaction(
      { clientId: 'delta-capita', issuingEntityId: 'autonize-it-ltd', date: '2025-01-01' },
      full,
    );
    expect(c).toBeNull();
  });

  it('returns the extension when the date falls inside the extension window', () => {
    const c = findContractForTransaction(
      { clientId: 'la-fosse', issuingEntityId: 'autonize-it-ltd', date: '2026-05-01' },
      full,
    );
    expect(c?.id).toBe('lf-extension-1');
  });

  it('returns the parent contract when the date falls inside the parent window', () => {
    const c = findContractForTransaction(
      { clientId: 'la-fosse', issuingEntityId: 'autonize-it-ltd', date: '2026-02-01' },
      full,
    );
    expect(c?.id).toBe('lf-2026-mar');
  });

  it('returns the contract with the latest start_date when ranges overlap', () => {
    // Boundary case: 2026-04-01 is exactly lf-extension-1.start_date AND one
    // day after lf-2026-mar.end_date (2026-03-31) — only the extension matches.
    const c = findContractForTransaction(
      { clientId: 'la-fosse', issuingEntityId: 'autonize-it-ltd', date: '2026-04-01' },
      full,
    );
    expect(c?.id).toBe('lf-extension-1');
  });

  it('returns null for an unknown (client, entity) pair', () => {
    const c = findContractForTransaction(
      { clientId: 'la-fosse', issuingEntityId: 'autonize-it-fzco', date: '2026-02-01' },
      full,
    );
    expect(c).toBeNull();
  });

  describe('same client split across two issuing entities', () => {
    // Same client_id 'la-fosse' on both rows; the UK Ltd row covers
    // 2026-01-06 → 2026-03-01 (ended/superseded), the FZCO row picks
    // up 2026-03-02 → 2026-04-30. entityId must be the discriminator,
    // not date alone.
    const splitReg = makeTestContractRegistry({
      contracts: [
        parseContractRow({ ...lfContractRow, end_date: '2026-03-01' }),
        parseContractRow(lfFzcoContractRow),
      ],
      clients,
      companies,
      masters,
    });

    it('matches the UK Ltd row for a UK Ltd transaction inside its window', () => {
      const c = findContractForTransaction(
        { clientId: 'la-fosse', issuingEntityId: 'autonize-it-ltd', date: '2026-02-15' },
        splitReg,
      );
      expect(c?.id).toBe('lf-2026-mar');
    });

    it('matches the FZCO row for a FZCO transaction inside its window', () => {
      const c = findContractForTransaction(
        { clientId: 'la-fosse', issuingEntityId: 'autonize-it-fzco', date: '2026-04-15' },
        splitReg,
      );
      expect(c?.id).toBe('lf-2026-apr');
    });

    it('never crosses entities — FZCO query on a UK Ltd-era date returns null', () => {
      const c = findContractForTransaction(
        { clientId: 'la-fosse', issuingEntityId: 'autonize-it-fzco', date: '2026-02-15' },
        splitReg,
      );
      expect(c).toBeNull();
    });

    it('never crosses entities — UK Ltd query on a FZCO-era date returns null', () => {
      const c = findContractForTransaction(
        { clientId: 'la-fosse', issuingEntityId: 'autonize-it-ltd', date: '2026-04-15' },
        splitReg,
      );
      expect(c).toBeNull();
    });
  });

  it('distinguishes across fixtures (purity)', () => {
    const inDc = findContractForTransaction(
      { clientId: 'la-fosse', issuingEntityId: 'autonize-it-ltd', date: '2026-02-01' },
      dcOnly,
    );
    expect(inDc).toBeNull();
  });
});

describe('upsertContract', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('appends a new contract when id is not present', () => {
    const reg = upsertContract({
      contract: parseContractRow(dcSowRow),
      clientsDir: tmpDir,
      input: { clients, companies, masters },
    });
    expect(reg.all.map(c => c.id)).toEqual(['dc-sow-2026']);
    const onDisk = readContractsCsvFile(getContractsCsvPath(tmpDir));
    expect(onDisk.map(c => c.id)).toEqual(['dc-sow-2026']);
  });

  it('replaces an existing contract when id matches', () => {
    upsertContract({
      contract: parseContractRow(dcSowRow),
      clientsDir: tmpDir,
      input: { clients, companies, masters },
    });
    const updatedRow = {
      ...dcSowRow,
      day_rate: '700',
    };
    const reg = upsertContract({
      contract: parseContractRow(updatedRow),
      clientsDir: tmpDir,
      input: { clients, companies, masters },
    });
    expect(reg.all).toHaveLength(1);
    expect(reg.all[0]?.day_rate).toBe(700);
  });

  it('rejects a contract with a bad FK at write time', () => {
    const bad = parseContractRow({ ...dcSowRow, client_id: 'ghost' });
    expect(() =>
      upsertContract({
        contract: bad,
        clientsDir: tmpDir,
        input: { clients, companies, masters },
      }),
    ).toThrow(/unknown client_id 'ghost'/);
    // The CSV must not have been written (file should not exist).
    expect(fs.existsSync(getContractsCsvPath(tmpDir))).toBe(false);
  });
});
