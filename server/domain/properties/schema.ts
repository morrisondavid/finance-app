/**
 * Properties domain — Zod schema + inferred TS types.
 *
 * Canonical registry of physical properties. Owns one stable
 * `property_id` per place, the address for display, and the household
 * ownership split (per §1.7). Rental status is NOT a property of the
 * property — it's an attribute of the obligation row that references it
 * (a property is "rental" in any month it has a `rental-income`
 * obligation pointing at its id).
 *
 * This registry's primary job is to make the rent ↔ mortgage join
 * legible: rental-income obligations and landlord-insurance obligations
 * carry `property_id` (1.7.2), and `debts.csv` mortgage rows already
 * carry `property_id`. Joining all three through this registry
 * replaces today's `display_name`-string match with a real FK.
 */

import { z } from 'zod';

export const PropertyIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, {
  message: 'PropertyId must be kebab-case (lowercase letters, digits, hyphens).',
});
export type PropertyId = z.infer<typeof PropertyIdSchema>;

export const PropertySchema = z.object({
  /** Stable id. Kebab-case; used as foreign key in obligations.csv and debts.csv. */
  id: PropertyIdSchema,
  /** Postal address as displayed. Free-form. */
  address: z.string().min(1),
  /** Ownership share for David (0..1). `ownership_david + ownership_heena` must equal 1. */
  ownership_david: z.number().min(0).max(1),
  /** Ownership share for Heena (0..1). `ownership_david + ownership_heena` must equal 1. */
  ownership_heena: z.number().min(0).max(1),
  /** Free-form notes. Optional. */
  notes: z.string().nullable(),
  /** ISO-date this row was last edited. */
  updated_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).readonly();

export type Property = z.infer<typeof PropertySchema>;

export const PropertiesDataSchema = z.array(PropertySchema).readonly();
export type PropertiesData = z.infer<typeof PropertiesDataSchema>;
