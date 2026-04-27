/**
 * Reserves domain — Zod schema + inferred TS types (§1.8).
 *
 * Maps `(obligation_type, entity_id)` to the canonical "reserve
 * account" where funds for that obligation should accumulate. Replaces
 * the historic `showTaxLiabilities: boolean` flag with a real policy:
 * the warnings emitter checks the reserve balance against upcoming
 * obligation amounts and fires `tax-reserve-underfunded` /
 * `tax-reserve-trajectory-missing` when the gap is material.
 *
 * Composite key: `(obligation_type, entity_id)`. Same obligation type
 * can have a different reserve per entity (UK VAT → barclays-savings,
 * FZCO VAT → emirates-islamic).
 *
 * Naming: the registry is generic ("reserves") so future non-tax
 * earmarks (property maintenance, school fees) can land here without
 * rename. Today's only consumer is the §1.8 tax-reserve emitter; its
 * warning codes stay tax-specific (`tax-reserve-*`).
 */

import { z } from 'zod';
import {
  AccountNameSchema,
  EntityIdSchema,
  ObligationTypeSchema,
} from '../../../shared/api-contracts.js';

export const ReserveSchema = z.object({
  /** Obligation type the reserve funds (`vat`, `corporation-tax`, `self-assessment`, …). */
  obligation_type: ObligationTypeSchema,
  /** Entity the obligation belongs to (UK Ltd or FZCO). */
  entity_id: EntityIdSchema,
  /** Account where reserve funds accumulate. */
  reserve_account: AccountNameSchema,
  /** Free-form notes (rationale, exceptions, accountant guidance). */
  notes: z.string().nullable(),
  /** ISO date this row was last edited. */
  updated_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).readonly();

export type Reserve = z.infer<typeof ReserveSchema>;

export const ReservesDataSchema = z.array(ReserveSchema).readonly();
export type ReservesData = z.infer<typeof ReservesDataSchema>;

/**
 * Composite key for the `byKey` index. Uses `::` as the separator so
 * neither half can contain it (kebab-case ids).
 */
export function reserveKey(obligationType: string, entityId: string): string {
  return `${obligationType}::${entityId}`;
}
