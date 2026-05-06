/**
 * Smoke tests for the §1.9 Debt Strategy HTTP surface.
 *
 * Mocks the orchestrator + mutations so the route's HTTP translation
 * (status codes, body shape, validation) is tested in isolation.
 * The orchestrator's domain integration is covered by its own test
 * suite (per-pure-module + lost-contract integration test).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type {
  AssembledDebtStrategy,
  DebtStrategyContext,
} from '../domain/debt-strategy/assemble.js';
import type { Plan, SuggestedPlan } from '../domain/debt-strategy/schema.js';
import type { PlanWithPayoffSummary } from '../domain/debt-strategy/suggested-plan-payoff-options.js';
import type { Movement } from '../domain/debt-strategy/movements-schema.js';
import type { AssembledStrategyCapitalSnapshot } from '../domain/debt-strategy/strategy-capital.js';
import { evaluateCrossScopeTransferPlaceholder } from '../domain/debt-strategy/evaluate-cross-scope-transfer.js';

const assembleMock = vi.fn<() => AssembledDebtStrategy>();
const persistPlanMock = vi.fn();
const persistMovementMock = vi.fn();
const deletePlanMock = vi.fn();

const { assembleRunwayScenarioMock } = vi.hoisted(() => ({
  assembleRunwayScenarioMock: vi.fn(() => ({
    firstStressDate: null as string | null,
    runwayMonths: null as number | null,
  })),
}));

vi.mock('../domain/forecast/assemble-runway.js', () => ({
  assembleRunwayScenario: assembleRunwayScenarioMock,
}));

vi.mock('../domain/debt-strategy/assemble.js', () => ({
  assembleDebtStrategy: () => assembleMock(),
}));

vi.mock('../domain/debt-strategy/mutations.js', () => ({
  persistPlan: (plan: Plan) => persistPlanMock(plan),
  persistMovement: (m: Movement) => persistMovementMock(m),
  deletePlan: (id: string) => deletePlanMock(id),
}));

const planRegistryMock = vi.fn<() => { indexes: { byId: Map<string, Plan> } }>();
const movementRegistryMock = vi.fn<() => { indexes: { byId: Map<string, Movement> } }>();

vi.mock('../domain/debt-strategy/registry.js', () => ({
  getPlanRegistry: () => planRegistryMock(),
}));
vi.mock('../domain/debt-strategy/movements-registry.js', () => ({
  getMovementRegistry: () => movementRegistryMock(),
}));

const { default: debtStrategyRouter } = await import('./debt-strategy.js');

let server: Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/debt-strategy', debtStrategyRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function stopServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  }
}

function emptyStrategyCapital(today: string): AssembledStrategyCapitalSnapshot {
  return {
    today,
    strategy_end_date: today,
    planning_range_end_exclusive: '2026-04-26',
    by_bucket: [],
    holistic: {
      display_currency: 'GBP',
      total_deployable_money: 0,
      total_typical_monthly_bills: 0,
      two_month_bill_reserve: 0,
      usable_for_debt_paydown: 0,
      holistic_money_for_debt_gbp: 0,
      holistic_money_for_debt_aed: 0,
      holistic_per_scope_row_sum_gbp: 0,
      holistic_per_scope_row_sum_aed: 0,
    },
    recommended_lump_sum_allocations: [],
  };
}

function emptyBundle(): AssembledDebtStrategy {
  const today = '2026-04-25';
  const sc = emptyStrategyCapital(today);
  const debtStrategyContext: DebtStrategyContext = {
    today,
    strategyCapital: sc,
    debtsById: new Map(),
    strategyPeriodApproxMonths: 1,
    availableHeadroomByBucket: new Map(),
    holisticMoneyForDebtGbp: sc.holistic.holistic_money_for_debt_gbp,
    holisticMoneyForDebtAed: sc.holistic.holistic_money_for_debt_aed,
  };
  return {
    today,
    headroomByBucket: new Map(),
    activePlans: [],
    pausedPlans: [],
    completedPlans: [],
    suggestedPlans: [],
    movements: [],
    feasibilityReports: new Map(),
    refinanceComparisons: new Map(),
    targetReachedReports: new Map(),
    strategyCapital: sc,
    refinanceRecommendations: new Map(),
    creditCardPaydownHints: [],
    crossScopeTransferPreview: evaluateCrossScopeTransferPlaceholder({
      sourceScope: 'household',
      targetScope: 'autonize-it-ltd',
      sourceCurrency: 'GBP',
      targetCurrency: 'GBP',
    }),
    debtStrategyContext,
    sandboxIncomeSources: { contracts: [], recurring: [] },
  };
}

function planWithPayoff(p: Plan): PlanWithPayoffSummary {
  return { ...p, payoff_summary: null };
}

function makePlan(over: Partial<Plan> & Pick<Plan, 'id'>): Plan {
  return {
    id: over.id,
    display_name: over.display_name ?? `Plan ${over.id}`,
    goal_type: over.goal_type ?? 'pay-off-debt',
    target_id: over.target_id ?? 'funding-circle',
    target_amount: over.target_amount ?? null,
    target_account: 'barclays-current',
    target_date_or_asap: 'ASAP',
    currency: 'GBP',
    scope: 'autonize-it-ltd',
    intensity: 'medium',
    monthly_allocation: 400,
    status: over.status ?? 'active',
    activated_at: '2026-04-01',
    completed_at: null,
    projected_completion_date: null,
    notes: null,
    updated_at: '2026-04-01',
  };
}

function makeMov(over: Partial<Movement> & Pick<Movement, 'id' | 'plan_id'>): Movement {
  return {
    from_account: 'natwest',
    to_account: 'barclays-current',
    amount: 400,
    day_of_month: 1,
    expected_start_date: '2026-04-01',
    expected_end_date: null,
    acknowledged_at: null,
    dismissed_missed_until: null,
    updated_at: '2026-04-01',
    ...over,
  };
}

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(() => {
  assembleMock.mockReset();
  assembleRunwayScenarioMock.mockReset();
  assembleRunwayScenarioMock.mockReturnValue({
    firstStressDate: null,
    runwayMonths: null,
  });
  persistPlanMock.mockReset();
  persistMovementMock.mockReset();
  deletePlanMock.mockReset();
  planRegistryMock.mockReset();
  movementRegistryMock.mockReset();
});

describe('GET /api/debt-strategy/state', () => {
  it('returns the bundle as JSON with bucketed headroom + plan lists', async () => {
    assembleMock.mockReturnValue({
      ...emptyBundle(),
      activePlans: [planWithPayoff(makePlan({ id: 'p1' }))],
      headroomByBucket: new Map([
        [
          'GBP::autonize-it-ltd',
          {
            currency: 'GBP',
            scope: 'autonize-it-ltd',
            totalHeadroom: 1000,
            availableHeadroom: 600,
            intensityOptions: {
              aggressive: { monthlyAllocation: 570, projectedCompletionDate: null },
              medium: { monthlyAllocation: 300, projectedCompletionDate: null },
              passive: { monthlyAllocation: 90, projectedCompletionDate: null },
              feasible: true,
            },
          },
        ],
      ]),
    });
    const res = await fetch(`${baseUrl}/api/debt-strategy/state`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      activePlans: Plan[];
      headroomByBucket: { key: string; availableHeadroom: number }[];
    };
    expect(body.activePlans).toHaveLength(1);
    expect(body.headroomByBucket[0].availableHeadroom).toBe(600);
  });

  it('returns 500 with a structured error if the orchestrator throws', async () => {
    assembleMock.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await fetch(`${baseUrl}/api/debt-strategy/state`);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('state-failed');
  });
});

describe('POST /api/debt-strategy/plans — validation', () => {
  it('400 on empty body', async () => {
    assembleMock.mockReturnValue(emptyBundle());
    const res = await fetch(`${baseUrl}/api/debt-strategy/plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('400 when pay-off-debt is missing targetId', async () => {
    assembleMock.mockReturnValue(emptyBundle());
    const res = await fetch(`${baseUrl}/api/debt-strategy/plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Test',
        goalType: 'pay-off-debt',
        // Missing targetId
        fromAccount: 'natwest',
        targetAccount: 'barclays-current',
        targetDateOrAsap: 'ASAP',
        currency: 'GBP',
        scope: 'autonize-it-ltd',
        intensity: 'medium',
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/debt-strategy/plans/:id/pause', () => {
  it('200 + persists the paused plan', async () => {
    const plan = makePlan({ id: 'p1' });
    planRegistryMock.mockReturnValue({
      indexes: { byId: new Map([['p1', plan]]) },
    });
    const res = await fetch(`${baseUrl}/api/debt-strategy/plans/p1/pause`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(persistPlanMock).toHaveBeenCalledOnce();
    const arg = persistPlanMock.mock.calls[0][0] as Plan;
    expect(arg.status).toBe('paused');
  });

  it('404 when plan does not exist', async () => {
    planRegistryMock.mockReturnValue({ indexes: { byId: new Map() } });
    const res = await fetch(`${baseUrl}/api/debt-strategy/plans/nonexistent/pause`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/debt-strategy/plans/:id/movements/:movementId/acknowledge', () => {
  it('persists the acknowledged_at timestamp', async () => {
    const mov = makeMov({ id: 'm1', plan_id: 'p1' });
    movementRegistryMock.mockReturnValue({
      indexes: { byId: new Map([['m1', mov]]) },
    });
    const res = await fetch(
      `${baseUrl}/api/debt-strategy/plans/p1/movements/m1/acknowledge`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    );
    expect(res.status).toBe(200);
    expect(persistMovementMock).toHaveBeenCalledOnce();
    const updated = persistMovementMock.mock.calls[0][0] as Movement;
    expect(updated.acknowledged_at).not.toBeNull();
  });

  it('400 when movement.plan_id does not match URL', async () => {
    const mov = makeMov({ id: 'm1', plan_id: 'other-plan' });
    movementRegistryMock.mockReturnValue({
      indexes: { byId: new Map([['m1', mov]]) },
    });
    const res = await fetch(
      `${baseUrl}/api/debt-strategy/plans/p1/movements/m1/acknowledge`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/debt-strategy/plans/:id', () => {
  it('200 + cascades the delete', async () => {
    const plan = makePlan({ id: 'p1' });
    planRegistryMock.mockReturnValue({
      indexes: { byId: new Map([['p1', plan]]) },
    });
    const res = await fetch(`${baseUrl}/api/debt-strategy/plans/p1`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(deletePlanMock).toHaveBeenCalledWith('p1');
  });

  it('404 when plan does not exist', async () => {
    planRegistryMock.mockReturnValue({ indexes: { byId: new Map() } });
    const res = await fetch(`${baseUrl}/api/debt-strategy/plans/nonexistent`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/debt-strategy/sandbox', () => {
  it('accepts exclusion lists and calls assemble twice', async () => {
    assembleMock.mockReturnValue(emptyBundle());
    const res = await fetch(`${baseUrl}/api/debt-strategy/sandbox`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenario: {
          excludedContractIds: ['c1'],
          excludedRecurringIncomeKeys: ['declared:x'],
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(assembleMock).toHaveBeenCalledTimes(2);
    expect(assembleRunwayScenarioMock).toHaveBeenCalledWith({
      excludedContractIds: ['c1'],
      excludedRecurringIncomeKeys: ['declared:x'],
    });
  });

  it('omits second assemble when scenario has no exclusions', async () => {
    assembleMock.mockReturnValue(emptyBundle());
    const res = await fetch(`${baseUrl}/api/debt-strategy/sandbox`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: {} }),
    });
    expect(res.status).toBe(200);
    expect(assembleMock).toHaveBeenCalledTimes(1);
    expect(assembleRunwayScenarioMock).toHaveBeenCalledWith({
      excludedContractIds: [],
      excludedRecurringIncomeKeys: [],
    });
  });

  it('returns scenarioHolisticGbpRunway from assembleRunwayScenario', async () => {
    assembleMock.mockReturnValue(emptyBundle());
    assembleRunwayScenarioMock.mockReturnValue({
      firstStressDate: '2026-09-01',
      runwayMonths: 4.25,
    });
    const res = await fetch(`${baseUrl}/api/debt-strategy/sandbox`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenario: { excludedContractIds: ['any'], excludedRecurringIncomeKeys: [] },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      scenarioHolisticGbpRunway: { firstStressDate: string; runwayMonths: number };
    };
    expect(body.scenarioHolisticGbpRunway.firstStressDate).toBe('2026-09-01');
    expect(body.scenarioHolisticGbpRunway.runwayMonths).toBe(4.25);
  });

  it('returns a bundle matching the sandbox response shape', async () => {
    assembleMock.mockReturnValue(emptyBundle());
    const res = await fetch(`${baseUrl}/api/debt-strategy/sandbox`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenario: { excludedContractIds: ['any'], excludedRecurringIncomeKeys: [] },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { activePlans: Plan[]; suggestedPlans: SuggestedPlan[] };
    expect(Array.isArray(body.activePlans)).toBe(true);
    expect(Array.isArray(body.suggestedPlans)).toBe(true);
  });
});
