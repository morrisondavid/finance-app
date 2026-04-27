/**
 * Plan movements — Zod schema + inferred TS types (§1.9).
 *
 * One row per standing order belonging to a plan. A plan can have 1+
 * movements (e.g. £400 to Funding Circle on the 1st AND £100 to a
 * savings buffer on the 15th).
 *
 * Persisted in `debt-strategy/movements.csv` (CSV-backed, no SQLite
 * table); FK on `plan_id` resolved by the registry's manifest test.
 *
 * `last_detected_match_date` and `status` are intentionally NOT on
 * this row — they are derived state recomputed on every
 * `assembleDebtStrategy()` call from `transactions` via
 * `doAmountsAndDatesMatch`.
 */

import { z } from 'zod';
import {
  AccountNameSchema,
  type AccountName,
} from '../../../shared/api-contracts.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEBAB_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export const MovementSchema = z.object({
  id: z.string().regex(KEBAB_ID_RE),
  /** FK → `plans.csv.id`. Validated at registry build time. */
  plan_id: z.string().regex(KEBAB_ID_RE),
  from_account: AccountNameSchema,
  to_account: AccountNameSchema,
  amount: z.number().positive(),
  /**
   * 1–28. UK bank standing orders use 28 as the safe ceiling so that
   * months with 28/29/30/31 days don't trigger ambiguous behaviour.
   */
  day_of_month: z.number().int().min(1).max(28),
  expected_start_date: z.string().regex(ISO_DATE_RE),
  expected_end_date: z.string().regex(ISO_DATE_RE).nullable(),
  /**
   * ISO date when the user marked the standing order as set up at the
   * bank. Canonical user input — must persist across DB rebuilds.
   * `null` until the user clicks "I've set this up".
   */
  acknowledged_at: z.string().regex(ISO_DATE_RE).nullable(),
  /**
   * ISO date until which `plan-transfer-missed` warnings are silenced.
   * Set when the user dismisses a missed-warning. `null` (or absent)
   * means warnings fire normally.
   */
  dismissed_missed_until: z.string().regex(ISO_DATE_RE).nullable(),
  updated_at: z.string().regex(ISO_DATE_RE),
}).readonly();

export type Movement = z.infer<typeof MovementSchema>;

export const MovementsDataSchema = z.array(MovementSchema).readonly();
export type MovementsData = z.infer<typeof MovementsDataSchema>;

export type { AccountName };
