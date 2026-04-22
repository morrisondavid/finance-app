/**
 * Company domain — schema re-exports.
 *
 * The canonical Zod schema lives in `shared/api-contracts.ts`
 * (`CompanySchema` + its UK / UAE variants) so that API response
 * validation and registry validation both key off the same
 * discriminated union. This file re-exports the public surface under
 * the canonical `schema.ts` name so the company domain mirrors every
 * other registry in `server/domain/`.
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
} from '../../../shared/api-contracts.js';
