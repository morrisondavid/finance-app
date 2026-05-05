/**
 * GET /api/debt-strategy/state — returns the §1.9 bundle.
 * POST /api/debt-strategy/plans — create + activate a plan.
 * POST /api/debt-strategy/plans/:id/activate-suggested — flip a route-only
 *      suggested plan into a persisted active one.
 * POST /api/debt-strategy/plans/:id/movements/:movementId/acknowledge
 * POST /api/debt-strategy/plans/:id/movements/:movementId/dismiss-missed
 * POST /api/debt-strategy/plans/:id/pause | /resume
 * DELETE /api/debt-strategy/plans/:id
 * POST /api/debt-strategy/sandbox — what-if read.
 *
 * Thin route. Delegates to `assembleDebtStrategy` for reads + the
 * `mutations.ts` module for writes.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  AccountNameSchema,
  CurrencyCodeSchema,
  EntityIdSchema,
} from '../../shared/api-contracts.js';
import {
  assembleDebtStrategy,
  type AssembledDebtStrategy,
} from '../domain/debt-strategy/assemble.js';
import {
  generatePlan,
  type GeneratePlanGoal,
} from '../domain/debt-strategy/generate-plan.js';
import { bucketKey } from '../domain/debt-strategy/auto-suggest-plans.js';
import {
  PlanIntensitySchema,
  PlanGoalTypeSchema,
  type Plan,
  type PlanScope,
} from '../domain/debt-strategy/schema.js';
import { getPlanRegistry } from '../domain/debt-strategy/registry.js';
import { getMovementRegistry } from '../domain/debt-strategy/movements-registry.js';
import {
  persistPlan,
  persistMovement,
  deletePlan,
} from '../domain/debt-strategy/mutations.js';
import { approxStrategyPeriodMonths } from '../domain/debt-strategy/strategy-capital.js';
import { todayIsoLocal } from '../../shared/iso-date.js';
import { getDebt, getDebtSummary } from '../db/repositories/debts.js';
import { afterPlanActivateSideEffects } from '../domain/debt-strategy/after-plan-activate.js';

const router = Router();

const PlanScopeSchema = z.union([z.literal('household'), EntityIdSchema]);

const CreatePlanBody = z.object({
  displayName: z.string().min(1),
  goalType: PlanGoalTypeSchema,
  /** Debt id when `pay-off-debt`. Required there, null/absent for save-for-target. */
  targetId: z.string().nullable().optional(),
  /** Required for save-for-target. */
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

function bundleToResponse(bundle: AssembledDebtStrategy): unknown {
  return {
    today: bundle.today,
    headroomByBucket: Array.from(bundle.headroomByBucket.entries()).map(([key, b]) => ({
      key,
      currency: b.currency,
      scope: b.scope,
      totalHeadroom: b.totalHeadroom,
      availableHeadroom: b.availableHeadroom,
      intensityOptions: b.intensityOptions,
    })),
    activePlans: bundle.activePlans,
    pausedPlans: bundle.pausedPlans,
    completedPlans: bundle.completedPlans,
    suggestedPlans: bundle.suggestedPlans,
    movements: bundle.movements,
    feasibilityReports: Array.from(bundle.feasibilityReports.entries()).map(([id, r]) => ({
      planId: id,
      ...r,
    })),
    refinanceComparisons: Array.from(bundle.refinanceComparisons.entries()).map(([id, r]) => ({
      debtId: id,
      ...r,
    })),
    targetReachedReports: Array.from(bundle.targetReachedReports.entries()).map(([id, r]) => ({
      planId: id,
      ...r,
    })),
    strategyCapital: bundle.strategyCapital,
    refinanceRecommendations: Array.from(bundle.refinanceRecommendations.entries()).map(
      ([debtId, r]) => ({
        debtId,
        kind: r.kind,
        total_cost_savings_vs_keep: r.total_cost_savings_vs_keep,
      }),
    ),
    creditCardPaydownHints: bundle.creditCardPaydownHints,
    crossScopeTransferPreview: bundle.crossScopeTransferPreview,
    debtStrategyContext: bundle.debtStrategyContext,
  };
}

router.get('/state', (_req: Request, res: Response) => {
  try {
    const bundle = assembleDebtStrategy({});
    res.json(bundleToResponse(bundle));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'state-failed', message });
  }
});

router.post('/plans', (req: Request, res: Response) => {
  try {
    const parsed = CreatePlanBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-body', issues: parsed.error.issues });
      return;
    }
    const body = parsed.data;
    const today = todayIsoLocal();
    const targetAmount = body.targetAmount ?? 0;

    if (body.goalType === 'pay-off-debt' && !body.targetId) {
      res.status(400).json({ error: 'pay-off-debt requires targetId' });
      return;
    }
    if (body.goalType === 'save-for-target' && !body.targetAmount) {
      res.status(400).json({ error: 'save-for-target requires targetAmount' });
      return;
    }

    const bundle = assembleDebtStrategy({ today });
    const headroom =
      bundle.headroomByBucket.get(bucketKey(body.currency, body.scope))?.availableHeadroom ?? 0;
    const hol = bundle.strategyCapital.holistic;
    const moneyForDebtStrategy =
      body.currency === 'AED' ? hol.holistic_money_for_debt_aed : hol.holistic_money_for_debt_gbp;
    const strategyPeriodApproxMonths = approxStrategyPeriodMonths(
      today,
      bundle.strategyCapital.strategy_end_date,
    );

    const goal: GeneratePlanGoal = {
      goalType: body.goalType,
      displayName: body.displayName,
      targetId: body.targetId ?? null,
      targetAmount,
      targetDateOrAsap: body.targetDateOrAsap,
      currency: body.currency,
      scope: body.scope as PlanScope,
      fromAccount: body.fromAccount,
      targetAccount: body.targetAccount,
      notes: body.notes ?? null,
    };

    const planId = `plan-${Date.now()}`;
    const movementId = `${planId}-mov-1`;
    const baselineMonthlyTowardTarget =
      body.goalType === 'pay-off-debt' && body.targetId
        ? (() => {
            const d = getDebt(body.targetId);
            if (d === null || d.matchAmounts.length === 0) return undefined;
            return d.matchAmounts[0] ?? 0;
          })()
        : undefined;

    const result = generatePlan({
      goal,
      intensity: body.intensity,
      availableHeadroom: headroom,
      today,
      planId,
      movementId,
      dayOfMonth: body.dayOfMonth,
      budgetedCategories: new Set(),
      requiredBudgetedCategories: new Set(), // route-level v1 doesn't enforce
      moneyForDebtStrategy,
      strategyPeriodApproxMonths,
      baselineMonthlyTowardTarget,
    });

    if (result.blocked) {
      res.status(409).json({
        error: 'plan-blocked',
        code: result.code,
        detail: result.detail,
        missingCategories: result.missingCategories,
      });
      return;
    }

    persistPlan(result.plan);
    for (const m of result.movements) {
      persistMovement(m);
    }
    afterPlanActivateSideEffects({ planId: result.plan.id });
    res.status(201).json({ plan: result.plan, movements: result.movements });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'create-failed', message });
  }
});

const ActivateSuggestedBody = z
  .object({
    intensity: PlanIntensitySchema.optional(),
    /** When `after_lump`, server activates the **medium** monthly standing order; the user pays the recommended lump at the bank from deployable cash first. */
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

router.post('/plans/:id/activate-suggested', (req: Request, res: Response) => {
  try {
    const parsed = ActivateSuggestedBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-body', issues: parsed.error.issues });
      return;
    }
    const body = parsed.data;
    const choice = body.choice ?? 'monthly';
    const effectiveIntensity =
      choice === 'after_lump' ? ('medium' as const) : body.intensity;
    if (effectiveIntensity === undefined) {
      res.status(400).json({ error: 'intensity required' });
      return;
    }
    const today = todayIsoLocal();
    const bundle = assembleDebtStrategy({ today });
    const suggestedId = typeof req.params.id === 'string' ? req.params.id : '';
    const suggested = bundle.suggestedPlans.find(s => s.id === suggestedId);
    if (suggested === undefined) {
      res.status(404).json({ error: 'suggested-plan-not-found' });
      return;
    }

    if (suggested.target_id === null) {
      res.status(400).json({ error: 'suggested-plan-missing-target' });
      return;
    }
    const debtRow = getDebt(suggested.target_id);
    if (debtRow === null) {
      res.status(404).json({ error: 'debt-not-found' });
      return;
    }
    const debt = getDebtSummary(debtRow);
    const baselineMonthlyTowardTarget =
      debt.matchAmounts.length === 0
        ? undefined
        : debt.matchAmounts[0] ?? 0;

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
      res.status(400).json({
        error: 'lump-covers-balance',
        detail: 'The recommended lump would clear this debt; no monthly plan is needed.',
      });
      return;
    }

    const goal: GeneratePlanGoal = {
      goalType: suggested.goal_type,
      displayName: body.displayName ?? suggested.display_name,
      targetId: suggested.target_id,
      targetAmount: targetAmountForGoal,
      targetDateOrAsap: suggested.target_date_or_asap,
      currency: suggested.currency,
      scope: suggested.scope,
      fromAccount: suggested.target_account, // suggested.target_account doubles as source for pay-off-debt
      targetAccount: suggested.target_account,
      notes: null,
    };
    const headroom =
      bundle.headroomByBucket.get(bucketKey(suggested.currency, suggested.scope))?.availableHeadroom ?? 0;
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
    const result = generatePlan({
      goal,
      intensity: effectiveIntensity,
      availableHeadroom: headroom,
      today,
      planId,
      movementId,
      dayOfMonth: body.dayOfMonth,
      budgetedCategories: new Set(),
      requiredBudgetedCategories: new Set(),
      moneyForDebtStrategy,
      strategyPeriodApproxMonths,
      baselineMonthlyTowardTarget,
    });
    if (result.blocked) {
      res.status(409).json({
        error: 'plan-blocked',
        code: result.code,
        detail: result.detail,
      });
      return;
    }
    persistPlan(result.plan);
    for (const m of result.movements) persistMovement(m);
    afterPlanActivateSideEffects({ planId: result.plan.id });
    res.status(201).json({ plan: result.plan, movements: result.movements });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'activate-failed', message });
  }
});

function paramOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

router.post('/plans/:id/movements/:movementId/acknowledge', (req: Request, res: Response) => {
  const today = todayIsoLocal();
  const movementId = paramOrEmpty(req.params.movementId);
  const planId = paramOrEmpty(req.params.id);
  const movement = getMovementRegistry().indexes.byId.get(movementId);
  if (movement === undefined) {
    res.status(404).json({ error: 'movement-not-found' });
    return;
  }
  if (movement.plan_id !== planId) {
    res.status(400).json({ error: 'movement-plan-mismatch' });
    return;
  }
  const updated = { ...movement, acknowledged_at: today, updated_at: today };
  persistMovement(updated);
  res.json({ movement: updated });
});

router.post('/plans/:id/movements/:movementId/dismiss-missed', (req: Request, res: Response) => {
  const today = todayIsoLocal();
  const Body = z.object({ until: z.string().optional() });
  const parsed = Body.safeParse(req.body);
  const movementId = paramOrEmpty(req.params.movementId);
  const movement = getMovementRegistry().indexes.byId.get(movementId);
  if (movement === undefined) {
    res.status(404).json({ error: 'movement-not-found' });
    return;
  }
  // Default 30 days silence.
  const defaultUntil = new Date(today);
  defaultUntil.setUTCDate(defaultUntil.getUTCDate() + 30);
  const until =
    parsed.success && parsed.data.until !== undefined
      ? parsed.data.until
      : defaultUntil.toISOString().slice(0, 10);
  const updated = { ...movement, dismissed_missed_until: until, updated_at: today };
  persistMovement(updated);
  res.json({ movement: updated });
});

function setStatusOrFail(
  req: Request,
  res: Response,
  newStatus: 'paused' | 'active',
): void {
  const today = todayIsoLocal();
  const planId = paramOrEmpty(req.params.id);
  const plan = getPlanRegistry().indexes.byId.get(planId);
  if (plan === undefined) {
    res.status(404).json({ error: 'plan-not-found' });
    return;
  }
  const updated: Plan = { ...plan, status: newStatus, updated_at: today };
  persistPlan(updated);
  res.json({ plan: updated });
}

router.post('/plans/:id/pause', (req: Request, res: Response) =>
  setStatusOrFail(req, res, 'paused'),
);

router.post('/plans/:id/resume', (req: Request, res: Response) =>
  setStatusOrFail(req, res, 'active'),
);

router.delete('/plans/:id', (req: Request, res: Response) => {
  const planId = paramOrEmpty(req.params.id);
  const plan = getPlanRegistry().indexes.byId.get(planId);
  if (plan === undefined) {
    res.status(404).json({ error: 'plan-not-found' });
    return;
  }
  deletePlan(planId);
  res.json({ deleted: planId });
});

const SandboxBody = z.object({
  scenario: z.object({
    /** Multiplier applied to the income side of the planner (0 = none, 1 = full). */
    incomeMultiplier: z.number().min(0).max(1).optional(),
  }),
});

router.post('/sandbox', (req: Request, res: Response) => {
  try {
    const parsed = SandboxBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-body', issues: parsed.error.issues });
      return;
    }
    const today = todayIsoLocal();
    const live = assembleDebtStrategy({ today });
    const incomeOverrides = new Map<string, number>();
    if (parsed.data.scenario.incomeMultiplier !== undefined) {
      const mult = parsed.data.scenario.incomeMultiplier;
      for (const [key, b] of live.headroomByBucket) {
        // Re-derive income proxy from the headroom + mandatory + budgets:
        // this is approximate; the orchestrator's only override hook is
        // total income, so we apply the multiplier there.
        const totalIncome = b.totalHeadroom + 0; // headroom approximates income−mandatory−budgets
        incomeOverrides.set(key, totalIncome * mult);
      }
    }
    const sandbox = assembleDebtStrategy({ today, incomeOverrides });
    res.json(bundleToResponse(sandbox));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'sandbox-failed', message });
  }
});

export default router;
