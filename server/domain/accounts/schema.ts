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
  AispFeedCurrencyCodeSchema,
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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Credit-card-specific configuration (§1.9). Optional on every
 * account; only meaningful on `type: 'credit-card'` rows. When
 * populated, the §1.9 Debt Strategy planner can model "move debt
 * onto this card" plans honestly. When absent on a credit-card
 * account, the planner refuses to consider that card and the §1.8
 * `account-credit-card-config-missing` warning surfaces the gap.
 *
 * All percentages are decimal fractions (`0.249` = 24.9% APR), same
 * convention as `interestRate` on `Debt`.
 */
export const CreditCardPromoSchema = z.object({
  /** Promotional APR while the intro window is active. */
  apr: z.number().min(0).max(1),
  /** ISO date the promo intro period ends. After this, `standardApr` applies. */
  expiresAt: z.string().regex(ISO_DATE_RE),
  /** Up-front transfer fee as a decimal fraction of the moved balance. */
  transferFeePct: z.number().min(0).max(1),
  /** Required minimum monthly payment as a decimal fraction of (current or original) balance. */
  minPaymentPct: z.number().min(0).max(1),
  /**
   * Whether missing the minimum payment terminates the promo (true on
   * most UK 0%-balance-transfer offers — a single late payment ends
   * the intro APR and reverts to the standard rate).
   */
  minPaymentTerminatesPromo: z.boolean(),
});
export type CreditCardPromo = z.infer<typeof CreditCardPromoSchema>;

export const CreditCardConfigSchema = z.object({
  /** Standard APR after any promo period (or always, if no promo active). */
  standardApr: z.number().min(0).max(1),
  promo: CreditCardPromoSchema.optional(),
});
export type CreditCardConfig = z.infer<typeof CreditCardConfigSchema>;

/**
 * Enable Banking-specific connectivity hints / linked-account ids that
 * live on `AccountConfig` once a bank link has been completed.
 *
 * Namespaced under `aispFeed.enableBanking` so future providers
 * (TrueLayer, Yapily, etc.) can add their own slice without colliding —
 * `aispFeed.trueLayer.accountId`, etc. The enclosing `aispFeed` object
 * is optional everywhere because most accounts are still ingested via
 * manual CSV upload.
 *
 * Field semantics:
 *   - `accountId`: stable Enable Banking UUID for this app account.
 *     Required for `runFeedSync` to actually call the Enable API; absent
 *     means "feed not yet linked" and the sync fails fast with a typed
 *     error. Copied from Enable after the bank-link flow completes.
 *   - `institutionHint`: optional `{ institutionName, country }` — only
 *     used to pre-select the bank in Enable's link UI. Not secret, not
 *     the linked-account id, omittable when you always pick the bank
 *     manually.
 *   - `feedCurrency`: optional code for validating Enable transaction amounts.
 *     Defaults to `account.currency`. Use when the sandbox ASPSP returns a
 *     different code than the book account ({@link AispFeedCurrencyCodeSchema}).
 */
export const EnableBankingFeedConfigSchema = z.object({
  accountId: z.string().min(1).optional(),
  institutionHint: z
    .object({
      institutionName: z.string().min(1),
      country: z.string().length(2),
    })
    .optional(),
  feedCurrency: AispFeedCurrencyCodeSchema.optional(),
});
export type EnableBankingFeedConfig = z.infer<typeof EnableBankingFeedConfigSchema>;

/**
 * TrueLayer Data API linkage (§3.4). OAuth stores refresh tokens separately;
 * `dataAccountId` is the `/data/v1/accounts/:id` resource id after linking.
 */
export const TrueLayerFeedConfigSchema = z.object({
  dataAccountId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  feedCurrency: AispFeedCurrencyCodeSchema.optional(),
});
export type TrueLayerFeedConfig = z.infer<typeof TrueLayerFeedConfigSchema>;

export const AispFeedConfigSchema = z.object({
  enableBanking: EnableBankingFeedConfigSchema.optional(),
  trueLayer: TrueLayerFeedConfigSchema.optional(),
});
export type AispFeedConfig = z.infer<typeof AispFeedConfigSchema>;

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
  /** §1.9 — credit-card-specific terms. Optional everywhere. */
  creditCard: CreditCardConfigSchema.optional(),
  /**
   * When false, balances on this account are excluded from “money you can
   * use now” in capital-aware debt strategy. When omitted: credit-card
   * accounts default false; other types default true.
   */
  deployableForStrategy: z.boolean().optional(),
  /**
   * Optional per-provider AISP feed connectivity (§3.4 Modular AISP feed).
   * Absent or with empty slices means "this account is manual upload only".
   * Providers: `enableBanking`, `trueLayer` (`runFeedSync` picks one —
   * TrueLayer preferred when linked with token + account id).
   */
  aispFeed: AispFeedConfigSchema.optional(),
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
