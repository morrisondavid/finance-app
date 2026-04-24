/**
 * Clients registry — single source of truth for who pays (direct or
 * agency) and, for agency engagements, the end client where the work
 * is actually delivered (§1.2 Phase A).
 *
 * Load path: `clients/clients.csv` is committed to git with the
 * production seed rows (Delta Capita direct, La Fosse agency). The
 * registry is lazily built at first access via {@link createRegistry}
 * and cached for the lifetime of the process.
 *
 * Every question the registry answers is a precomputed index. Callers
 * read `registry.indexes.<name>` — no consumer re-filters `all`.
 *
 * Adding a new named question:
 *   1. Add the field to `ClientRegistry.indexes` below.
 *   2. Populate it in `buildClientRegistryFromData` using the `_shared`
 *      index builders.
 *   3. Expose a named query in `queries.ts`.
 *   4. Document the consumer(s) in `registry.manifest.test.ts`.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type { Client, ClientId, ClientKind } from '../../../shared/api-contracts.js';
import { createRegistry } from '../_shared/create-registry.js';
import {
  filterToIndex,
  groupBy,
  indexBy,
} from '../_shared/index-builders.js';
import { getClientsCsvPath, readClientsCsvFile } from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_CLIENTS_DIR = path.join(__dirname, '../../../clients');

export interface ClientRegistry {
  /** Every configured client, in CSV order. */
  readonly all: readonly Client[];
  readonly indexes: {
    /** Primary-key lookup by client id. Duplicate ids fail at build time. */
    readonly byId: ReadonlyMap<ClientId, Client>;
    /** Clients grouped by `kind` (`direct` | `agency`). */
    readonly byKind: ReadonlyMap<ClientKind, readonly Client[]>;
    /** Clients with `active === true`. */
    readonly active: readonly Client[];
  };
}

/**
 * Build a client registry from a raw array of parsed rows. Exposed for
 * tests and for the default file-backed loader
 * ({@link buildClientRegistry}).
 */
export function buildClientRegistryFromData(
  all: readonly Client[],
): ClientRegistry {
  const byId = indexBy(all, c => c.id, { indexName: 'clients.byId' });
  const byKind = groupBy(all, c => c.kind);
  const active = filterToIndex(all, c => c.active);

  return {
    all,
    indexes: {
      byId,
      byKind,
      active,
    },
  };
}

export function buildClientRegistry(
  clientsDir: string = DEFAULT_CLIENTS_DIR,
): ClientRegistry {
  return buildClientRegistryFromData(
    readClientsCsvFile(getClientsCsvPath(clientsDir)),
  );
}

const handle = createRegistry<ClientRegistry>({
  name: 'clients',
  build: () => buildClientRegistry(),
});

export const getClientRegistry = handle.get;
export const invalidateClientRegistry = handle.invalidate;
export const __resetClientRegistryForTests = handle.__resetForTests;
