/**
 * Company registry — the single source of truth for the legally-
 * distinct entities this app accounts for (Roadmap 1.1).
 *
 * Load path: `autonize-it/company.csv` is committed to git with both
 * the UK Ltd and the UAE FZCO seed rows. The registry is lazily built
 * at first access and cached for the lifetime of the process.
 *
 * Tests reset the cache with {@link __resetCompanyRegistryForTests} so
 * one test's singleton cannot leak into another.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type { Company, EntityId, Jurisdiction } from '../../../shared/api-contracts.js';
import { getCompanyCsvPath, readCompaniesCsvFile } from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_AUTONIZE_IT_DIR = path.join(__dirname, '../../../autonize-it');

export interface CompanyRegistry {
  readonly all: readonly Company[];
  getById(entityId: EntityId): Company | null;
  listEntityIds(): readonly EntityId[];
  listByJurisdiction(jurisdiction: Jurisdiction): readonly Company[];
}

export function buildCompanyRegistry(
  autonizeItDir: string = DEFAULT_AUTONIZE_IT_DIR,
): CompanyRegistry {
  const companies = readCompaniesCsvFile(getCompanyCsvPath(autonizeItDir));

  const byId = new Map<EntityId, Company>();
  for (const c of companies) {
    if (byId.has(c.id)) {
      throw new Error(`Company registry: duplicate id '${c.id}' in company.csv`);
    }
    byId.set(c.id, c);
  }

  return {
    all: companies,
    getById(entityId: EntityId): Company | null {
      return byId.get(entityId) ?? null;
    },
    listEntityIds(): readonly EntityId[] {
      return companies.map(c => c.id);
    },
    listByJurisdiction(jurisdiction: Jurisdiction): readonly Company[] {
      return companies.filter(c => c.jurisdiction === jurisdiction);
    },
  };
}

/**
 * Lazily-built default singleton used by the server runtime. Tests
 * should ignore it and call {@link buildCompanyRegistry} with a
 * fixture directory instead; call {@link __resetCompanyRegistryForTests}
 * from hot-reload paths if you must invalidate the cache.
 */
let cached: CompanyRegistry | null = null;

export function getCompanyRegistry(): CompanyRegistry {
  if (cached === null) cached = buildCompanyRegistry();
  return cached;
}

/** Reset the default singleton (tests only). */
export function __resetCompanyRegistryForTests(): void {
  cached = null;
}
