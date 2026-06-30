/**
 * Mutations for `/api/debt-strategy/*` write endpoints — Express + MCP.
 */

import { z } from 'zod';
import {
  AccountNameSchema,
  CurrencyCodeSchema,
  EntityIdSchema,
} from '../../../shared/api-contracts.js';
import { assembleDebtStrategy } from '../../domain/debt-strategy/assemble.js';
import { debtStrategyBundleToResponseJson } from '../../domain/debt-strategy/bundle-to-response-json.js';
import { assembleRunwayScenario } from '../../domain/forecast/assemble-runway.js';
import { generatePlan, type GeneratePlanGoal } from '../../domain/debt-strategy/generate-plan.js';
import { bucketKey } from '../../domain/debt-strategy/auto-suggest-plans.js';
import {
  PlanIntensitySchema,
  PlanGoalTypeSchema,
  type Plan,
  type PlanScope,
} from '../../domain/debt-strategy/schema.js';
import { getPlanRegistry } from '../../domain/debt-strategy/registry.js';
import { getMovementRegistry } from '../../domain/debt-strategy/movements-registry.js';
import { persistPlan, persistMovement, deletePlan } from '../../domain/debt-strategy/mutations.js';
import { approxStrategyPeriodMonths } from '../../domain/debt-strategy/strategy-capital.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { getDebt, getDebtSummary } from '../../db/repositories/debts.js';
import { afterPlanActivateSideEffects } from '../../domain/debt-strategy/after-plan-activate.js';
import type { JsonMutationResult } from './types.js';

const PlanScopeSchema = z.union([z.literal('household'), EntityIdSchema]);

export const DebtStrategyCreatePlanBodySchema = z.object({
  displayName: z.string().min(1),
  goalType: PlanGoalTypeSchema,
  targetId: z.string().nullable().optional(),
  targetAmount: z.number().positive().optional(),
  fromAccount: AccountNameSchema,
  targetAccount: AccountNameSchema,
  targetDateOrAsap: z.string(),
  currency: CurrencyCodeSchema,
  scope: PlanScopeSchema,
  intensity: PlanIntensitySchema,
  dayOfMonth: z.number().int().min(1).max(28).default(1),
  notes: z.string().nullable().optional(),
});

export const DebtStrategyActivateSuggestedBodySchema = z
  .object({
    intensity: PlanIntensitySchema.optional(),
    choice: z.enum(['monthly', 'after_lump']).optional(),
    dayOfMonth: z.number().int().min(1).max(28).default(1),
    displayName: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    const choice = data.choice ?? 'monthly';
    if (choice === 'after_lump') return;
    if (data.intensity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'intensity is required unless choice is after_lump',
        path: ['intensity'],
      });
    }
  });

export const DebtStrategySandboxBodySchema = z.object({
  scenario: z.object({
    excludedContractIds: z.array(z.string()).optional(),
    excludedRecurringIncomeKeys: z.array(z.string()).optional(),
    redirectSalaryToDebt: z.boolean().optional(),
  }),
});

export const DebtStrategyDismissMissedBodySchema = z.object({
  until: z.string().optional(),
});

function paramOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** POST `/api/debt-strategy/plans` — **persisted** plan + movements. */
export function mutateDebtStrategyCreatePlan(body: unknown): JsonMutationResult {
  try {
    const parsed = DebtStrategyCreatePlanBodySchema.safeParse(body);
    if (!parsed.success) {
      return { status: 400, body: { error: 'invalid-body', issues: parsed.error.issues } };
    }
    const reqBody = parsed.data;
    const today = todayIsoLocal();
    const targetAmount = reqBody.targetAmount ?? 0;

    if (reqBody.goalType === 'pay-off-debt' && !reqBody.targetId) {
      return { status: 400, body: { error: 'pay-off-debt requires targetId' } };
    }
    if (reqBody.goalType === 'save-for-target' && !reqBody.targetAmount) {
      return { status: 400, body: { error: 'save-for-target requires targetAmount' } };
    }

    const bundle = assembleDebtStrategy({ today });
    const headroom =
      bundle.headroomByBucket.get(bucketKey(reqBody.currency, reqBody.scope))?.availableHeadroom ?? 0;
    const hol = bundle.strategyCapital.holistic;
    const moneyForDebtStrategy =
      reqBody.currency === 'AED'
        ? hol.holistic_money_for_debt_aed
        : hol.holistic_money_for_debt_gbp;
    const strategyPeriodApproxMonths = approxStrategyPeriodMonths(
      today,
      bundle.strategyCapital.strategy_end_date,
    );

    const goal: GeneratePlanGoal = {
      goalType: reqBody.goalType,
      displayName: reqBody.displayName,
      targetId: reqBody.targetId ?? null,
      targetAmount,
      targetDateOrAsap: reqBody.targetDateOrAsap,
      currency: reqBody.currency,
      scope: reqBody.scope as PlanScope,
      fromAccount: reqBody.fromAccount,
      targetAccount: reqBody.targetAccount,
      notes: reqBody.notes ?? null,
    };

    const planId = `plan-${Date.now()}`;
    const movementId = `${planId}-mov-1`;
    const baselineMonthlyTowardTarget =
      reqBody.goalType === 'pay-off-debt' && reqBody.targetId
        ? (() => {
            const d = getDebt(reqBody.targetId);
            if (d === null || d.matchAmounts.length === 0) return undefined;
            return d.matchAmounts[0] ?? 0;
          })()
        : undefined;

    const result = generatePlan({
      goal,
      intensity: reqBody.intensity,
      availableHeadroom: headroom,
      today,
      planId,
      movementId,
      dayOfMonth: reqBody.dayOfMonth,
      budgetedCategories: new Set(),
      requiredBudgetedCategories: new Set(),
      moneyForDebtStrategy,
      strategyPeriodApproxMonths,
      baselineMonthlyTowardTarget,
    });

    if (result.blocked) {
      return {
        status: 409,
        body: {
          error: 'plan-blocked',
          code: result.code,
          detail: result.detail,
          missingCategories: result.missingCategories,
        },
      };
    }

    persistPlan(result.plan);
    for (const m of result.movements) {
      persistMovement(m);
    }
    afterPlanActivateSideEffects({ planId: result.plan.id });
    return { status: 201, body: { plan: result.plan, movements: result.movements } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return { status: 500, body: { error: 'create-failed', message } };
  }
}

/** POST `/api/debt-strategy/plans/:id/activate-suggested` */
export function mutateDebtStrategyActivateSuggested(
  suggestedPlanId: string,
  body: unknown,
): JsonMutationResult {
  try {
    const parsed = DebtStrategyActivateSuggestedBodySchema.safeParse(body);
    if (!parsed.success) {
      return { status: 400, body: { error: 'invalid-body', issues: parsed.error.issues } };
    }
    const reqBody = parsed.data;
    const choice = reqBody.choice ?? 'monthly';
    const effectiveIntensity = choice === 'after_lump' ? ('medium' as const) : reqBody.intensity;
    if (effectiveIntensity === undefined) {
      return { status: 400, body: { error: 'intensity required' } };
    }
    const today = todayIsoLocal();
    const bundle = assembleDebtStrategy({ today });
    const suggested = bundle.suggestedPlans.find(s => s.id === suggestedPlanId);
    if (suggested === undefined) {
      return { status: 404, body: { error: 'suggested-plan-not-found' } };
    }

    if (suggested.target_id === null) {
      return { status: 400, body: { error: 'suggested-plan-missing-target' } };
    }
    const debtRow = getDebt(suggested.target_id);
    if (debtRow === null) {
      return { status: 404, body: { error: 'debt-not-found' } };
    }
    const debt = getDebtSummary(debtRow);
    const baselineMonthlyTowardTarget =
      debt.matchAmounts.length === 0 ? undefined : debt.matchAmounts[0] ?? 0;

    const targetAmountForGoal = (() => {
      if (choice !== 'after_lump' || suggested.target_id === null) {
        return debt.currentBalance;
      }
      const lumpRow = bundle.strategyCapital.recommended_lump_sum_allocations.find(
        a => a.debt_id === suggested.target_id,
      );
      const lumpAmt = lumpRow?.recommended_lump_sum ?? 0;
      if (lumpAmt <= 0) return debt.currentBalance;
      const rem = Math.max(0, debt.currentBalance - Math.min(lumpAmt, debt.currentBalance));
      return Math.round(rem * 100) / 100;
    })();

    if (choice === 'after_lump' && targetAmountForGoal <= 0) {
      return {
        status: 400,
        body: {
          error: 'lump-covers-balance',
          detail: 'The recommended lump would clear this debt; no monthly plan is needed.',
        },
      };
    }

    const goal: GeneratePlanGoal = {
      goalType: suggested.goal_type,
      displayName: reqBody.displayName ?? suggested.display_name,
      targetId: suggested.target_id,
      targetAmount: targetAmountForGoal,
      targetDateOrAsap: suggested.target_date_or_asap,
      currency: suggested.currency,
      scope: suggested.scope,
      fromAccount: suggested.target_account,
      targetAccount: suggested.target_account,
      notes: null,
    };
    const headroom =
      bundle.headroomByBucket.get(bucketKey(suggested.currency, suggested.scope))?.availableHeadroom ??
      0;
    const hol = bundle.strategyCapital.holistic;
    const moneyForDebtStrategy =
      suggested.currency === 'AED'
        ? hol.holistic_money_for_debt_aed
        : hol.holistic_money_for_debt_gbp;
    const strategyPeriodApproxMonths = approxStrategyPeriodMonths(
      today,
      bundle.strategyCapital.strategy_end_date,
    );
    const planId = `plan-${Date.now()}`;
    const movementId = `${planId}-mov-1`;
    const gpResult = generatePlan({
      goal,
      intensity: effectiveIntensity,
      availableHeadroom: headroom,
      today,
      planId,
      movementId,
      dayOfMonth: reqBody.dayOfMonth,
      budgetedCategories: new Set(),
      requiredBudgetedCategories: new Set(),
      moneyForDebtStrategy,
      strategyPeriodApproxMonths,
      baselineMonthlyTowardTarget,
    });
    if (gpResult.blocked) {
      return {
        status: 409,
        body: {
          error: 'plan-blocked',
          code: gpResult.code,
          detail: gpResult.detail,
        },
      };
    }
    persistPlan(gpResult.plan);
    for (const m of gpResult.movements) persistMovement(m);
    afterPlanActivateSideEffects({ planId: gpResult.plan.id });
    return { status: 201, body: { plan: gpResult.plan, movements: gpResult.movements } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return { status: 500, body: { error: 'activate-failed', message } };
  }
}

/** POST acknowledge movement */
export function mutateDebtStrategyMovementAcknowledge(
  planIdParam: string,
  movementIdParam: string,
): JsonMutationResult {
  const today = todayIsoLocal();
  const movementId = paramOrEmpty(movementIdParam);
  const planId = paramOrEmpty(planIdParam);
  const movement = getMovementRegistry().indexes.byId.get(movementId);
  if (movement === undefined) {
    return { status: 404, body: { error: 'movement-not-found' } };
  }
  if (movement.plan_id !== planId) {
    return { status: 400, body: { error: 'movement-plan-mismatch' } };
  }
  const updated = { ...movement, acknowledged_at: today, updated_at: today };
  persistMovement(updated);
  return { status: 200, body: { movement: updated } };
}

/** POST dismiss-missed */
export function mutateDebtStrategyMovementDismissMissed(
  movementIdParam: string,
  body: unknown,
): JsonMutationResult {
  const today = todayIsoLocal();
  const parsed = DebtStrategyDismissMissedBodySchema.safeParse(body);
  const movementId = paramOrEmpty(movementIdParam);
  const movement = getMovementRegistry().indexes.byId.get(movementId);
  if (movement === undefined) {
    return { status: 404, body: { error: 'movement-not-found' } };
  }
  const defaultUntil = new Date(today);
  defaultUntil.setUTCDate(defaultUntil.getUTCDate() + 30);
  const until =
    parsed.success && parsed.data.until !== undefined
      ? parsed.data.until
      : defaultUntil.toISOString().slice(0, 10);
  const updated = { ...movement, dismissed_missed_until: until, updated_at: today };
  persistMovement(updated);
  return { status: 200, body: { movement: updated } };
}

function setPlanStatus(planIdParam: string, newStatus: 'paused' | 'active'): JsonMutationResult {
  const today = todayIsoLocal();
  const planId = paramOrEmpty(planIdParam);
  const plan = getPlanRegistry().indexes.byId.get(planId);
  if (plan === undefined) {
    return { status: 404, body: { error: 'plan-not-found' } };
  }
  const updated: Plan = { ...plan, status: newStatus, updated_at: today };
  persistPlan(updated);
  return { status: 200, body: { plan: updated } };
}

export function mutateDebtStrategyPlanPause(planIdParam: string): JsonMutationResult {
  return setPlanStatus(planIdParam, 'paused');
}

export function mutateDebtStrategyPlanResume(planIdParam: string): JsonMutationResult {
  return setPlanStatus(planIdParam, 'active');
}

export function mutateDebtStrategyPlanDelete(planIdParam: string): JsonMutationResult {
  const planId = paramOrEmpty(planIdParam);
  const plan = getPlanRegistry().indexes.byId.get(planId);
  if (plan === undefined) {
    return { status: 404, body: { error: 'plan-not-found' } };
  }
  deletePlan(planId);
  return { status: 200, body: { deleted: planId } };
}

/** POST sandbox — **read-only** what-if composer. */
export function mutateDebtStrategySandbox(body: unknown): JsonMutationResult {
  try {
    const parsed = DebtStrategySandboxBodySchema.safeParse(body);
    if (!parsed.success) {
      return { status: 400, body: { error: 'invalid-body', issues: parsed.error.issues } };
    }
    const today = todayIsoLocal();
    const live = assembleDebtStrategy({ today });
    const sc = parsed.data.scenario;
    const excludedContractIds = sc.excludedContractIds ?? [];
    const excludedRecurringIncomeKeys = sc.excludedRecurringIncomeKeys ?? [];
    const redirectSalaryToDebt = sc.redirectSalaryToDebt === true;
    const hasExclusions =
      excludedContractIds.length > 0 ||
      excludedRecurringIncomeKeys.length > 0 ||
      redirectSalaryToDebt;
    const assembleInput = {
      today,
      ...(hasExclusions && (excludedContractIds.length > 0 || excludedRecurringIncomeKeys.length > 0)
        ? {
            incomeExclusions: {
              excludedContractIds,
              excludedRecurringIncomeKeys,
            },
          }
        : {}),
      ...(redirectSalaryToDebt ? { applySalaryRedirect: true } : {}),
    };
    const sandbox = hasExclusions
      ? assembleDebtStrategy(assembleInput)
      : live;
    const scenarioHolisticGbpRunway = assembleRunwayScenario({
      excludedContractIds,
      excludedRecurringIncomeKeys,
    });
    return {
      status: 200,
      body: {
        ...debtStrategyBundleToResponseJson(sandbox),
        scenarioHolisticGbpRunway,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return { status: 500, body: { error: 'sandbox-failed', message } };
  }
}
