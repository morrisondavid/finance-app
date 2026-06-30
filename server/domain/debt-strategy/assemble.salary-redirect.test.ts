/**
 * Integration tests for §1.9 salary-redirect opportunity + sandbox scenario.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { BudgetRow } from '../../db/repositories/budgets.js';
import type { AccountName } from '../../types.js';
import { usePopulatedIntegrationDatabase } from '../../db/test-harness/use-populated-integration-db.js';
import { bucketKey } from './auto-suggest-plans.js';

const { listBudgetsMock, actualListBudgetsRef } = vi.hoisted(() => ({
  listBudgetsMock: vi.fn<(filters: { account?: AccountName }) => BudgetRow[]>(),
  actualListBudgetsRef: { fn: null as ((filters: { account?: AccountName }) => BudgetRow[]) | null },
}));

vi.mock('../../db/repositories/budgets.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../db/repositories/budgets.js')>();
  actualListBudgetsRef.fn = actual.listBudgets;
  return {
    ...actual,
    listBudgets: (filters: { account?: AccountName }) => listBudgetsMock(filters),
  };
});

type AssembleDebtStrategy = typeof import('./assemble.js').assembleDebtStrategy;
type MutateSandbox = typeof import('../../http/mutation/debt-strategy.js').mutateDebtStrategySandbox;

let assembleDebtStrategy: AssembleDebtStrategy;
let mutateDebtStrategySandbox: MutateSandbox;

function passthroughBudgets(filters: { account?: AccountName }): BudgetRow[] {
  if (actualListBudgetsRef.fn === null) return [];
  return actualListBudgetsRef.fn(filters);
}

const generousHouseholdBudgetRows: BudgetRow[] = [
  {
    id: 1,
    account: 'monzo-joint',
    category: 'Eating Out',
    amount: 2000,
    period: 'monthly',
  },
];

describe('assembleDebtStrategy — salary redirect', () => {
  usePopulatedIntegrationDatabase(import.meta.url);

  beforeAll(async () => {
    listBudgetsMock.mockImplementation(passthroughBudgets);
    const assembleMod = await import('./assemble.js');
    assembleDebtStrategy = assembleMod.assembleDebtStrategy;
    const mutationMod = await import('../../http/mutation/debt-strategy.js');
    mutateDebtStrategySandbox = mutationMod.mutateDebtStrategySandbox;
  });

  it('exposes payroll totals on populated ledger when opportunity is present', () => {
    const bundle = assembleDebtStrategy({});
    const opp = bundle.salaryRedirectOpportunity;
    if (opp !== null) {
      expect(opp.salaryMonthlyTotal).toBe(1516);
      expect(opp.salaryEntries.length).toBe(2);
      expect(opp.bucketKey).toBe(bucketKey('GBP', 'household'));
    }
  });

  it('applySalaryRedirect increases household available headroom', () => {
    const baseline = assembleDebtStrategy({});
    const scenario = assembleDebtStrategy({ applySalaryRedirect: true });
    const householdKey = bucketKey('GBP', 'household');
    const baselineHeadroom = baseline.headroomByBucket.get(householdKey)?.availableHeadroom ?? 0;
    const scenarioHeadroom = scenario.headroomByBucket.get(householdKey)?.availableHeadroom ?? 0;
    expect(scenarioHeadroom).toBeGreaterThanOrEqual(baselineHeadroom);
    expect(scenario.salaryRedirectOpportunity).toBeNull();
    const opp = baseline.salaryRedirectOpportunity;
    if (opp !== null && opp.kind === 'cut-budgets') {
      expect(scenarioHeadroom).toBe(opp.whatIfAvailableHeadroom);
    }
  });

  it('reports needs-budget-caps when household has no budget rows', () => {
    listBudgetsMock.mockReturnValue([]);
    const bundle = assembleDebtStrategy({});
    const opp = bundle.salaryRedirectOpportunity;
    expect(opp).not.toBeNull();
    expect(opp?.kind).toBe('needs-budget-caps');
    expect(opp?.salaryMonthlyTotal).toBe(1516);
    expect(opp?.redirectableMonthly).toBe(0);
    listBudgetsMock.mockImplementation(passthroughBudgets);
  });

  it('cut-budgets uses redirectable amount capped by household budget caps', () => {
    listBudgetsMock.mockReturnValue(generousHouseholdBudgetRows);
    const baseline = assembleDebtStrategy({});
    const householdSuggestions = baseline.suggestedPlans.filter(sp => sp.scope === 'household');
    const opp = baseline.salaryRedirectOpportunity;
    if (householdSuggestions.length > 0) {
      expect(opp).toBeNull();
    } else {
      expect(opp).not.toBeNull();
      expect(opp?.kind).toBe('cut-budgets');
      expect(opp?.redirectableMonthly).toBe(1516);
      expect(opp?.whatIfIntensityOptions.medium.monthlyAllocation).toBeGreaterThan(0);
    }
    const scenario = assembleDebtStrategy({ applySalaryRedirect: true });
    const scenarioHeadroom =
      scenario.headroomByBucket.get(bucketKey('GBP', 'household'))?.availableHeadroom ?? 0;
    const baselineHeadroom =
      baseline.headroomByBucket.get(bucketKey('GBP', 'household'))?.availableHeadroom ?? 0;
    expect(scenarioHeadroom).toBeGreaterThanOrEqual(baselineHeadroom);
    listBudgetsMock.mockImplementation(passthroughBudgets);
  });

  it('populated ledger exposes cut-budgets capped by real household caps', () => {
    listBudgetsMock.mockImplementation(passthroughBudgets);
    const bundle = assembleDebtStrategy({});
    const opp = bundle.salaryRedirectOpportunity;
    if (opp !== null && opp.kind === 'cut-budgets') {
      expect(opp.redirectableMonthly).toBeGreaterThan(0);
      expect(opp.redirectableMonthly).toBeLessThanOrEqual(opp.salaryMonthlyTotal);
    }
  });

  it('sandbox redirectSalaryToDebt does not reduce household headroom', () => {
    listBudgetsMock.mockReturnValue(generousHouseholdBudgetRows);
    const live = assembleDebtStrategy({});
    const result = mutateDebtStrategySandbox({
      scenario: { redirectSalaryToDebt: true },
    });
    expect(result.status).toBe(200);
    const body = result.body as {
      headroomByBucket: Array<{ key: string; availableHeadroom: number }>;
    };
    const householdKey = bucketKey('GBP', 'household');
    const liveHeadroom = live.headroomByBucket.get(householdKey)?.availableHeadroom ?? 0;
    const scenarioHeadroom =
      body.headroomByBucket.find(r => r.key === householdKey)?.availableHeadroom ?? 0;
    expect(scenarioHeadroom).toBeGreaterThanOrEqual(liveHeadroom);
    listBudgetsMock.mockImplementation(passthroughBudgets);
  });
});
