/**
 * Clients domain — schema re-exports.
 *
 * The canonical Zod schema lives in `shared/api-contracts.ts`
 * (`ClientSchema` + its direct / agency discriminated-union variants)
 * so that API response validation and registry validation both key off
 * the same definitions. This file mirrors the convention used by every
 * other registry under `server/domain/`.
 */

export {
  ClientSchema,
  DirectClientSchema,
  AgencyClientSchema,
  ClientIdSchema,
  ClientKindSchema,
  TemplateKindSchema,
  type Client,
  type DirectClient,
  type AgencyClient,
  type ClientId,
  type ClientKind,
  type TemplateKind,
} from '../../../shared/api-contracts.js';
