/**
 * Debt Strategy plans — Zod schema + inferred TS types (§1.9).
 *
 * Each plan is a concrete commitment: pay off this debt by date X, or
 * save £Y for goal Z by date W. The §1.9 planner builds plans by
 * composing forecast headroom, the user's chosen intensity, the
 * target's terms, and the (separate) movements that flow money each
 * month. Movements live in a sibling `movements.csv` registry
 * (FK on `plan_id`) so each plan can have 1+ standing orders.
 *
 * Status lifecycle:
 *   `suggested` → ephemeral (route-level only; never persisted)
 *   `active`    → user clicked Activate; standing orders are running
 *   `paused`    → user paused; standing orders may continue at the bank
 *                 but the planner doesn't track progress
 *   `completed` → target reached; auto-flipped by `detectTargetReached`
 *
 * The CSV writer filters out `suggested` rows so they never persist.
 */

import { z } from 'zod';
import {
  AccountNameSchema,
  CurrencyCodeSchema,
  EntityIdSchema,
  type AccountName,
  type CurrencyCode,
} from '../../../shared/api-contracts.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_OR_ASAP_RE = /^(?:ASAP|\d{4}-\d{2}-\d{2})$/;
const KEBAB_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export const PlanGoalTypeSchema = z.enum(['pay-off-debt', 'save-for-target']);
export type PlanGoalType = z.infer<typeof PlanGoalTypeSchema>;

/** Persisted statuses ONLY. `suggested` is route-only and never written to CSV. */
export const PlanPersistedStatusSchema = z.enum(['active', 'paused', 'completed']);
export type PlanPersistedStatus = z.infer<typeof PlanPersistedStatusSchema>;

/** Full status enum (includes the ephemeral `suggested`). */
export const PlanStatusSchema = z.enum(['suggested', 'active', 'paused', 'completed']);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const PlanIntensitySchema = z.enum(['aggressive', 'medium', 'passive']);
export type PlanIntensity = z.infer<typeof PlanIntensitySchema>;

/**
 * `scope` — drives default routing of `target_account` when not
 * explicitly set, and decides which slice of the household forecast
 * the plan claims headroom from. `'household'` = personal accounts
 * (NatWest etc.). Entity ids = the corresponding business slice.
 */
export const PlanScopeSchema = z.union([z.literal('household'), EntityIdSchema]);
export type PlanScope = z.infer<typeof PlanScopeSchema>;

const PlanShape = z.object({
  id: z.string().regex(KEBAB_ID_RE),
  display_name: z.string().min(1),
  goal_type: PlanGoalTypeSchema,
  /** Debt id when `pay-off-debt`; null otherwise. */
  target_id: z.string().nullable(),
  /** Savings target amount when `save-for-target`; null for debt plans. */
  target_amount: z.number().positive().nullable(),
  target_account: AccountNameSchema,
  /** `'ASAP'` or an ISO date. */
  target_date_or_asap: z.string().regex(ISO_DATE_OR_ASAP_RE),
  currency: CurrencyCodeSchema,
  scope: PlanScopeSchema,
  intensity: PlanIntensitySchema,
  monthly_allocation: z.number().positive(),
  activated_at: z.string().regex(ISO_DATE_RE),
  /** ISO date set by `detectTargetReached` when target hits zero/reached. */
  completed_at: z.string().regex(ISO_DATE_RE).nullable(),
  /** Planner's projected date the goal is reached at the chosen intensity. */
  projected_completion_date: z.string().regex(ISO_DATE_RE).nullable(),
  notes: z.string().nullable(),
  updated_at: z.string().regex(ISO_DATE_RE),
});

/** Persisted plan (CSV-backed). Status enum forbids `suggested`. */
export const PlanSchema = PlanShape.extend({
  status: PlanPersistedStatusSchema,
}).readonly();

export type Plan = z.infer<typeof PlanSchema>;

/**
 * Suggested plans (route-only, ephemeral). Identical shape to a
 * persisted plan except `status === 'suggested'`. Returned by
 * `auto-suggest-plans` and the activation flow's preview; never
 * round-trips to disk.
 */
export const SuggestedPlanSchema = PlanShape.extend({
  status: z.literal('suggested'),
}).readonly();
export type SuggestedPlan = z.infer<typeof SuggestedPlanSchema>;

export const PlansDataSchema = z.array(PlanSchema).readonly();
export type PlansData = z.infer<typeof PlansDataSchema>;

/** Helpers shared by csv-io / queries / orchestrator. */
export const PLAN_TARGET_DATE_ASAP = 'ASAP' as const;
export type PlanTargetDate = typeof PLAN_TARGET_DATE_ASAP | string; // ISO date

export type { AccountName, CurrencyCode };
