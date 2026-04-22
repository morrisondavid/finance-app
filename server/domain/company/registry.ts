/**
 * Company registry — the single source of truth for the legally-
 * distinct entities this app accounts for (Roadmap 1.1).
 *
 * Load path: `autonize-it/company.csv` is committed to git with both
 * the UK Ltd and the UAE FZCO seed rows. The registry is lazily built
 * at first access via {@link createRegistry} and cached for the
 * lifetime of the process.
 *
 * Every question the registry answers is a precomputed index. Callers
 * read `registry.indexes.<name>` — no consumer re-filters `all`.
 *
 * Adding a new named question:
 *   1. Add the field to `CompanyRegistry.indexes` below.
 *   2. Populate it in `buildCompanyRegistry` using the `_shared`
 *      index builders.
 *   3. Expose a named query in `queries.ts`.
 *   4. Document the consumer(s) in `registry.manifest.test.ts`.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type {
  Company,
  EntityId,
  Jurisdiction,
} from '../../../shared/api-contracts.js';
import { createRegistry } from '../_shared/create-registry.js';
import {
  filterToIndex,
  groupBy,
  indexBy,
  mapToIndex,
} from '../_shared/index-builders.js';
import { getCompanyCsvPath, readCompaniesCsvFile } from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_AUTONIZE_IT_DIR = path.join(__dirname, '../../../autonize-it');

export interface CompanyRegistry {
  /** Every configured company, in CSV order. */
  readonly all: readonly Company[];
  /** Every entity id, in CSV order. */
  readonly entityIds: readonly EntityId[];
  readonly indexes: {
    /** Primary-key lookup by entity id. Duplicate ids fail at build time. */
    readonly byId: ReadonlyMap<EntityId, Company>;
    /** Companies grouped by jurisdiction (UK, UAE). */
    readonly byJurisdiction: ReadonlyMap<Jurisdiction, readonly Company[]>;
    /** Companies with `active === true`. */
    readonly active: readonly Company[];
  };
}

/**
 * Build a company registry from a raw array of parsed rows. Exposed
 * for tests and for the default file-backed loader
 * ({@link buildCompanyRegistry}).
 */
export function buildCompanyRegistryFromData(
  all: readonly Company[],
): CompanyRegistry {
  const byId = indexBy(all, c => c.id, { indexName: 'company.byId' });
  const byJurisdiction = groupBy(all, c => c.jurisdiction);
  const entityIds = mapToIndex(all, c => c.id);
  const active = filterToIndex(all, c => c.active);

  return {
    all,
    entityIds,
    indexes: {
      byId,
      byJurisdiction,
      active,
    },
  };
}

export function buildCompanyRegistry(
  autonizeItDir: string = DEFAULT_AUTONIZE_IT_DIR,
): CompanyRegistry {
  return buildCompanyRegistryFromData(
    readCompaniesCsvFile(getCompanyCsvPath(autonizeItDir)),
  );
}

const handle = createRegistry<CompanyRegistry>({
  name: 'company',
  build: () => buildCompanyRegistry(),
});

export const getCompanyRegistry = handle.get;
export const invalidateCompanyRegistry = handle.invalidate;
export const __resetCompanyRegistryForTests = handle.__resetForTests;
