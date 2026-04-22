/**
 * Merchants domain — Zod schema + inferred TS types.
 *
 * A merchant entry maps a regex pattern to a category and
 * (optionally) a clean display name. Both `categorizeTransaction`
 * and `normalizeMerchant` read the same ordered list, so category
 * assignments and display names can never drift out of sync.
 *
 * Entries with `displayName: null` contribute to categorisation
 * only — the normaliser falls through to later entries or its
 * generic cleanup fallback.
 */

import { z } from 'zod';
import { CATEGORY_NAMES, type CategoryName } from '../../../shared/category-names.js';

export { CATEGORY_NAMES };
export type { CategoryName };

export const CategoryNameSchema = z.enum(CATEGORY_NAMES);

export const MerchantEntrySchema = z
  .object({
    pattern: z.instanceof(RegExp),
    category: CategoryNameSchema,
    displayName: z.string().min(1).nullable(),
  })
  .readonly();

export type MerchantEntry = z.infer<typeof MerchantEntrySchema>;

export const MerchantDataSchema = z.array(MerchantEntrySchema).readonly();
export type MerchantData = z.infer<typeof MerchantDataSchema>;
