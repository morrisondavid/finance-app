/**
 * Tier-1 outcome MCP tools ({@link canonical-mcp-tool-registry} cross-domain slice).
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  IncomeCompositionResponseSchema,
  type AiFinancialSafetyResponse,
  type DashboardSummaryResponse,
  DashboardSummaryResponseSchema,
  HouseholdFinancialPostureResponseSchema,
} from '../../shared/api-contracts.js';
import { HouseholdFinancialPostureQuerySchema } from '../domain/ai/ai-get-query-schemas.js';
import { composeAiFinancialSafety, composeAiIncomeComposition } from '../domain/ai/index.js';
import { getDb } from '../db/connection.js';
import { usePopulatedIntegrationDatabase } from '../db/test-harness/use-populated-integration-db.js';
import { loadForecastInputs } from '../domain/forecast/load-inputs.js';
import { readDashboardSummaryFromQuery } from '../http/read/dashboard.js';
import {
  runAccountantReadinessSnapshotMcpTool,
  runAccountantReadinessFinancialYearMcpTool,
  runReportingListPeriodsMcpTool,
  runAccountantReadinessUpcomingMcpTool,
} from './accountant-pack-mcp-tools.js';
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

/**
 * The dashboard summary embeds `availableFunds`, which carries a live
 * `generatedAt` stamped at composition time. The orchestrating MCP tool and
 * the direct dashboard read compose moments apart, so that one timestamp
 * legitimately differs; pin it to a constant before the structural compare
 * (mirrors {@link expectFinancialSafetyStableFields} ignoring volatile stamps).
 */
function withStableAvailableFundsTimestamp(
  summary: DashboardSummaryResponse,
): DashboardSummaryResponse {
  if (summary.availableFunds === undefined) return summary;
  return {
    ...summary,
    availableFunds: { ...summary.availableFunds, generatedAt: 'stable' },
  };
}

describe('outcome MCP — income composition + posture + accountant readiness', () => {
  usePopulatedIntegrationDatabase(import.meta.url);

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
      const loaded = loadForecastInputs({
        horizonDays: query.days,
        filterEntityId: query.entityId,
      });
      const safetyOpts = {
        ...financialSafetyOptsFromHouseholdParsed(query),
        forecastInputs: loaded,
      };
      // §1.8 snapshots are write-on-read; reset so composer baseline matches MCP tool.
      getDb().exec('DELETE FROM warning_snapshots;');
      const expectedSafety = composeAiFinancialSafety(safetyOpts);
      getDb().exec('DELETE FROM warning_snapshots;');

      const r = runHouseholdFinancialPostureMcpTool({});
      expect(r.isError).toBeUndefined();
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
      const expectedDash = DashboardSummaryResponseSchema.parse(dash.body);
      expect(withStableAvailableFundsTimestamp(sc.dashboardSummary)).toEqual(
        withStableAvailableFundsTimestamp(expectedDash),
      );
      expect(typeof sc.generatedAt).toBe('string');
    },
    25_000,
  );

  it('accountant_readiness_snapshot returns not-configured for unsupported regime', () => {
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

  it('accountant_readiness_snapshot returns real present/missing for VAT', () => {
    const r = runAccountantReadinessSnapshotMcpTool({
      period_label: 'Q2-2025',
      regime: 'vat',
      entityId: 'autonize-it-ltd',
    });
    expect(r.isError).toBeUndefined();
    const sc = r.structuredContent;
    expect(sc).toBeDefined();
    if (!sc) return;
    expect(sc).toHaveProperty('present');
    expect(sc).toHaveProperty('missing');
    expect(sc).toHaveProperty('recommended_next_steps');
    expect(Array.isArray(sc.present)).toBe(true);
    expect(Array.isArray(sc.missing)).toBe(true);
    expect('code' in sc && sc.code === 'accountant-readiness-not-configured').toBe(false);
  });

  it('accountant_readiness_financial_year returns CT + four VAT quarters', () => {
    const r = runAccountantReadinessFinancialYearMcpTool({
      financial_year: '2025/26',
      entityId: 'autonize-it-ltd',
    });
    expect('isError' in r).toBe(false);
    if (!('structuredContent' in r)) return;
    const sc = r.structuredContent;
    expect(sc).toHaveProperty('corporationTax');
    expect(sc).toHaveProperty('vatQuarters');
    expect(sc).toHaveProperty('aggregate');
    if ('vatQuarters' in sc && Array.isArray(sc.vatQuarters)) {
      expect(sc.vatQuarters).toHaveLength(4);
    }
  });

  it('reporting_list_periods lists CT FY + VAT quarters', () => {
    const r = runReportingListPeriodsMcpTool({ financial_year: '2025/26' });
    expect('isError' in r).toBe(false);
    if (!('structuredContent' in r)) return;
    expect(r.structuredContent).toMatchObject({ ok: true, financialYear: '2025/26' });
  });

  it('accountant_readiness_upcoming returns a periods array', () => {
    const r = runAccountantReadinessUpcomingMcpTool({ deadline_horizon_days: 400 });
    expect('isError' in r).toBe(false);
    if (!('structuredContent' in r)) return;
    expect(r.structuredContent).toHaveProperty('periods');
  });
});
