/**
 * Accounts domain — Zod schema + inferred TS types.
 *
 * This is the single source of truth for the shape of an account's
 * configuration. Any caller that needs a `BusinessAccountConfig` or
 * `PersonalAccountConfig` should import from here; runtime validation
 * of loaded data happens by feeding it through `AccountConfigSchema`.
 *
 * A business account's tax status is an explicit, jurisdictional three-
 * axis concept:
 *   - `jurisdiction`: UK or UAE — governs which rules apply.
 *   - `vat`: whether the jurisdiction taxes income and whether the
 *     owning entity is registered. Both must be true for the account's
 *     income to feed VAT obligation emission.
 *   - `corpTax`: whether the jurisdiction imposes a corporate income
 *     tax on the account's income. UAE carries a `qualifyingFreeZone`
 *     sub-axis which is a hard gate — until the FZCO's QFZP status is
 *     explicitly elected (`true` / `false`) the account contributes no
 *     CT obligation rows.
 *
 * Personal accounts have no `business` block; the discriminated union
 * on `category` ensures one shape can never be mistaken for the other.
 */

import { z } from 'zod';
import {
  AccountNameSchema,
  AccountTypeSchema,
  CurrencyCodeSchema,
  EntityIdSchema,
  JurisdictionSchema,
  TbcSchema,
  type AccountName,
  type EntityId,
} from '../../../shared/api-contracts.js';

export type { AccountName, EntityId };

export const VatConfigSchema = z.object({
  applicable: z.boolean(),
  rate: z.number(),
  registered: z.boolean(),
});
export type VatConfig = z.infer<typeof VatConfigSchema>;

export const CorpTaxConfigSchema = z.object({
  applicable: z.boolean(),
  qualifyingFreeZone: z.union([z.boolean(), TbcSchema]),
});
export type CorpTaxConfig = z.infer<typeof CorpTaxConfigSchema>;

export const BusinessTaxConfigSchema = z.object({
  jurisdiction: JurisdictionSchema,
  vat: VatConfigSchema,
  corpTax: CorpTaxConfigSchema,
});
export type BusinessTaxConfig = z.infer<typeof BusinessTaxConfigSchema>;

const BaseAccountConfigSchema = z.object({
  name: AccountNameSchema,
  label: z.string(),
  type: AccountTypeSchema,
  currency: CurrencyCodeSchema,
  entityId: EntityIdSchema.nullable(),
  canMakeOutgoingPayments: z.boolean(),
  excludeTransfersFromIncome: z.boolean(),
  showTaxLiabilities: z.boolean(),
  quarterOverlapMonths: z.number().optional(),
});

export const BusinessAccountConfigSchema = BaseAccountConfigSchema.extend({
  category: z.literal('business'),
  entityId: EntityIdSchema,
  business: BusinessTaxConfigSchema,
});
export type BusinessAccountConfig = z.infer<typeof BusinessAccountConfigSchema>;

export const PersonalAccountConfigSchema = BaseAccountConfigSchema.extend({
  category: z.literal('personal'),
  entityId: z.null(),
});
export type PersonalAccountConfig = z.infer<typeof PersonalAccountConfigSchema>;

export const AccountConfigSchema = z.discriminatedUnion('category', [
  BusinessAccountConfigSchema,
  PersonalAccountConfigSchema,
]);
export type AccountConfig = z.infer<typeof AccountConfigSchema>;

/**
 * The raw data shape: a (possibly partial) map from `AccountName` to
 * its config. Passed into `buildAccountsRegistry` for validation +
 * index derivation.
 *
 * `data.ts` asserts completeness via `satisfies CompleteAccountConfigMap`
 * at module scope; runtime inputs (fixtures, CSV loaders) use the
 * partial type so sparse data is permitted and the loader's Zod parse
 * validates only the keys actually supplied.
 */
export const AccountConfigMapSchema = z.record(AccountNameSchema, AccountConfigSchema);
export type AccountConfigMap = Partial<Record<AccountName, AccountConfig>>;
export type CompleteAccountConfigMap = Record<AccountName, AccountConfig>;
