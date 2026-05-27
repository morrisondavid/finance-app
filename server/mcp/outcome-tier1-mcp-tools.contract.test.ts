/**
 * Tier-1 outcome MCP tools ({@link canonical-mcp-tool-registry} cross-domain slice).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { z } from 'zod';
import {
  IncomeCompositionResponseSchema,
  type AiFinancialSafetyResponse,
  HouseholdFinancialPostureResponseSchema,
} from '../../shared/api-contracts.js';
import { HouseholdFinancialPostureQuerySchema } from '../domain/ai/ai-get-query-schemas.js';
import { composeAiFinancialSafety, composeAiIncomeComposition } from '../domain/ai/index.js';
import { initDatabase, closeDatabase } from '../db/index.js';
import { readDashboardSummaryFromQuery } from '../http/read/dashboard.js';
import { runAccountantReadinessSnapshotMcpTool } from './accountant-pack-mcp-tools.js';
import { runHouseholdFinancialPostureMcpTool, runIncomeGetCompositionMcpTool } from './bank-mcp-server.js';

function financialSafetyOptsFromHouseholdParsed(
  parsed: z.infer<typeof HouseholdFinancialPostureQuerySchema>,
): Parameters<typeof composeAiFinancialSafety>[0] {
  const {
    includeBalancesByAccount: _b,
    days: horizonDays,
    entityId: filterEntityId,
    detail: runwayDetail,
    account,
    financialYear,
    groupByEntity,
    commitmentDays,
  } = parsed;
  return {
    horizonDays,
    commitmentDays,
    filterEntityId,
    runwayDetail,
    account,
    financialYear,
    groupByEntity,
  };
}

function expectFinancialSafetyStableFields(
  actual: AiFinancialSafetyResponse,
  expected: AiFinancialSafetyResponse,
): void {
  expect(actual.score).toBe(expected.score);
  expect(actual.formulaVersion).toBe(expected.formulaVersion);
  expect(actual.pillars).toEqual(expected.pillars);
  expect(actual.warningAdjustment).toEqual(expected.warningAdjustment);
  expect(actual.baseScoreBeforeWarnings).toBe(expected.baseScoreBeforeWarnings);
  expect(actual.schemaVersion).toBe(expected.schemaVersion);
  expect(typeof actual.generatedAt).toBe('string');
  const aRef = actual.inputsRef;
  const eRef = expected.inputsRef;
  expect(
    aRef &&
      eRef &&
      typeof aRef.financialSnapshotGeneratedAt === 'string' &&
      typeof eRef.financialSnapshotGeneratedAt === 'string',
  ).toBe(true);
}

describe('outcome MCP — income composition + posture + accountant readiness', () => {
  beforeAll(async () => {
    await initDatabase();
  }, 120_000);

  afterAll(() => {
    closeDatabase();
  });

  it('income_get_composition runner matches composer (IncomeCompositionResponseSchema)', () => {
    const expected = IncomeCompositionResponseSchema.parse(composeAiIncomeComposition());
    const r = runIncomeGetCompositionMcpTool({});
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toEqual(expected);
  });

  it(
    'household_financial_posture {} orchestrates safety + dashboard summary',
    () => {
      const query = HouseholdFinancialPostureQuerySchema.parse({});
      const r = runHouseholdFinancialPostureMcpTool({});
      expect(r.isError).toBeUndefined();
      const expectedSafety = composeAiFinancialSafety(financialSafetyOptsFromHouseholdParsed(query));
      const dash = readDashboardSummaryFromQuery({
        account: query.account,
        financialYear: query.financialYear,
      });
      expect(dash.ok).toBe(true);
      if (!dash.ok) {
        expect.fail('dashboard summary expected ok');
      }
      const sc = HouseholdFinancialPostureResponseSchema.parse(r.structuredContent);
      expectFinancialSafetyStableFields(sc.financialSafety, expectedSafety);
      expect(sc.dashboardSummary).toEqual(dash.body);
      expect(typeof sc.generatedAt).toBe('string');
    },
    25_000,
  );

  it('accountant_readiness_snapshot returns structured stub readiness envelope', () => {
    const r = runAccountantReadinessSnapshotMcpTool({
      period_label: 'FY2026',
      regime: 'all',
      deadline_horizon_days: 14,
    });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({
      ok: false,
      code: 'accountant-readiness-not-configured',
      period_label: 'FY2026',
    });
  });
});
