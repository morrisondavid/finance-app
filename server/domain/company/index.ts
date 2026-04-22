/**
 * Company domain — public barrel.
 *
 * Consumers should import from this file rather than reaching into
 * `registry.ts` / `queries.ts` directly so the domain boundary stays
 * stable.
 */

export {
  CompanySchema,
  UkCompanySchema,
  UaeCompanySchema,
  JurisdictionSchema,
  EntityIdSchema,
  type Company,
  type UkCompany,
  type UaeCompany,
  type Jurisdiction,
  type EntityId,
} from './schema.js';

export {
  buildCompanyRegistry,
  buildCompanyRegistryFromData,
  getCompanyRegistry,
  invalidateCompanyRegistry,
  __resetCompanyRegistryForTests,
  type CompanyRegistry,
} from './registry.js';

export {
  activeCompanies,
  allCompanies,
  allEntityIds,
  companiesByJurisdiction,
  companyById,
} from './queries.js';

export {
  makeTestCompanyRegistry,
  type CompanyRegistryFixtureInput,
} from './fixtures.js';
