/**
 * Contracts registry — single source of truth for time-bounded
 * engagements. §1.2 Phase A.
 *
 * There is deliberately no `type` column: "under a master agreement?"
 * is answered by `master_id !== null`; "renewal / extension of a prior
 * engagement?" is positional (look up the prior row in
 * `byClientAndEntity`, ordered by `start_date`).
 *
 * This registry is a *derived* view: it combines the raw contract rows
 * from `clients/contracts.csv` with the clients, company, and master-
 * agreements registries to validate foreign keys at build time. A bad
 * FK fails loudly during the registry build rather than much later at
 * a specific query call site.
 *
 * Indexes:
 *   - `byId` — primary-key lookup.
 *   - `byClient` — all contracts for a given `client_id`, ordered by
 *     `start_date` ascending (stable: CSV order breaks ties).
 *   - `byClientAndEntity` — all contracts for a given
 *     `(client_id, issuing_entity_id)` pair, ordered by `start_date`.
 *     This is the key index for the payment matcher and for deriving
 *     renewal position (the 2nd+ row in a series is the renewal).
 *   - `byMaster` — all contracts under a given master agreement id.
 *   - `active` — contracts with `active === true`, in CSV order.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type {
  Contract,
  ContractId,
  ClientId,
  EntityId,
  MasterAgreement,
  MasterAgreementId,
} from '../../../shared/api-contracts.js';
import { createRegistry } from '../_shared/create-registry.js';
import {
  filterToIndex,
  groupBy,
  indexBy,
} from '../_shared/index-builders.js';
import {
  getClientRegistry,
  type ClientRegistry,
} from '../clients/registry.js';
import {
  getCompanyRegistry,
  type CompanyRegistry,
} from '../company/registry.js';
import { loadMasterAgreements } from '../master-agreements/loader.js';
import { getContractsCsvPath, readContractsCsvFile } from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CLIENTS_DIR = path.join(__dirname, '../../../clients');

/** Compose the composite key for `byClientAndEntity`. */
export function clientEntityKey(clientId: ClientId, entityId: EntityId): string {
  return `${clientId}|${entityId}`;
}

export interface ContractRegistry {
  /** Every configured contract, in CSV order. */
  readonly all: readonly Contract[];
  readonly indexes: {
    readonly byId: ReadonlyMap<ContractId, Contract>;
    /** Contracts per client, ordered by `start_date` ascending. */
    readonly byClient: ReadonlyMap<ClientId, readonly Contract[]>;
    /** Contracts per `(client_id, issuing_entity_id)`, ordered by `start_date` ascending. */
    readonly byClientAndEntity: ReadonlyMap<string, readonly Contract[]>;
    /** Contracts under a given master agreement. Rows with `master_id === null` are absent. */
    readonly byMaster: ReadonlyMap<MasterAgreementId, readonly Contract[]>;
    /** Contracts with `active === true`. */
    readonly active: readonly Contract[];
  };
}

export interface BuildContractRegistryInput {
  readonly clients?: ClientRegistry;
  readonly companies?: CompanyRegistry;
  readonly masters?: readonly MasterAgreement[];
}

/**
 * Build a contract registry from a raw list of parsed rows plus the
 * upstream registries needed for FK validation. Exposed for tests and
 * for the default file-backed loader ({@link buildContractRegistry}).
 */
export function buildContractRegistryFromData(
  all: readonly Contract[],
  input: BuildContractRegistryInput = {},
): ContractRegistry {
  const clients = input.clients ?? getClientRegistry();
  const companies = input.companies ?? getCompanyRegistry();
  const masters = input.masters ?? loadMasterAgreements();

  const masterById = new Map<MasterAgreementId, MasterAgreement>();
  for (const m of masters) masterById.set(m.id, m);

  // FK validation — throw with a precise message for each offending row.
  for (const c of all) {
    if (!clients.indexes.byId.has(c.client_id)) {
      throw new Error(
        `Contract ${c.id}: unknown client_id '${c.client_id}' (not in clients registry)`,
      );
    }
    if (!companies.indexes.byId.has(c.issuing_entity_id)) {
      throw new Error(
        `Contract ${c.id}: unknown issuing_entity_id '${c.issuing_entity_id}' (not in company registry)`,
      );
    }
    if (c.master_id !== null) {
      const master = masterById.get(c.master_id);
      if (master === undefined) {
        throw new Error(
          `Contract ${c.id}: unknown master_id '${c.master_id}' (not in master-agreements)`,
        );
      }
      if (master.client_id !== c.client_id) {
        throw new Error(
          `Contract ${c.id}: master '${c.master_id}' is for client '${master.client_id}' but contract is for client '${c.client_id}'`,
        );
      }
    }

    // UK-only fields may only be populated when the issuing entity is UK.
    const issuer = companies.indexes.byId.get(c.issuing_entity_id);
    if (issuer !== undefined && issuer.jurisdiction !== 'UK') {
      if (c.conduct_regs !== null) {
        throw new Error(
          `Contract ${c.id}: conduct_regs is UK-only but issuing_entity '${c.issuing_entity_id}' is ${issuer.jurisdiction}`,
        );
      }
      if (c.engagement_tax_status !== null) {
        throw new Error(
          `Contract ${c.id}: engagement_tax_status is UK-only but issuing_entity '${c.issuing_entity_id}' is ${issuer.jurisdiction}`,
        );
      }
    }
  }

  const byId = indexBy(all, c => c.id, { indexName: 'contracts.byId' });

  const sortedByStartDate = (xs: readonly Contract[]): readonly Contract[] =>
    [...xs].sort((a, b) => a.start_date.localeCompare(b.start_date));

  const byClientRaw = groupBy(all, c => c.client_id);
  const byClient = new Map<ClientId, readonly Contract[]>();
  for (const [k, v] of byClientRaw) byClient.set(k, sortedByStartDate(v));

  const byClientAndEntityRaw = groupBy(all, c =>
    clientEntityKey(c.client_id, c.issuing_entity_id),
  );
  const byClientAndEntity = new Map<string, readonly Contract[]>();
  for (const [k, v] of byClientAndEntityRaw) byClientAndEntity.set(k, sortedByStartDate(v));

  const contractsWithMaster = filterToIndex(all, c => c.master_id !== null);
  const byMasterRaw = groupBy(
    contractsWithMaster,
    c => c.master_id as MasterAgreementId,
  );
  const byMaster = new Map<MasterAgreementId, readonly Contract[]>();
  for (const [k, v] of byMasterRaw) byMaster.set(k, sortedByStartDate(v));

  const active = filterToIndex(all, c => c.active);

  return {
    all,
    indexes: {
      byId,
      byClient,
      byClientAndEntity,
      byMaster,
      active,
    },
  };
}

export function buildContractRegistry(
  clientsDir: string = DEFAULT_CLIENTS_DIR,
  input: BuildContractRegistryInput = {},
): ContractRegistry {
  const rows = readContractsCsvFile(getContractsCsvPath(clientsDir));
  return buildContractRegistryFromData(rows, input);
}

const handle = createRegistry<ContractRegistry>({
  name: 'contracts',
  build: () => buildContractRegistry(),
});

export const getContractRegistry = handle.get;
export const invalidateContractRegistry = handle.invalidate;
export const __resetContractRegistryForTests = handle.__resetForTests;
