import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase } from '../db/index.js';
import { getDb } from '../db/connection.js';
import {
  FinancialSnapshotQuerySchema,
  HorizonEntityQuerySchema,
  RunwayQuerySchema,
  SnapshotQuerySchema,
} from '../domain/ai/ai-get-query-schemas.js';
import {
  composeAiFinancialSafety,
  composeAiFinancialSnapshot,
  composeAiLiquidity,
  composeAiPipeline,
  composeAiSnapshot,
  composeAiSpendByCurrency,
} from '../domain/ai/index.js';
import { assembleRunway } from '../domain/forecast/index.js';
import { runwayResponseFromAssembled } from '../domain/forecast/runway-api-response.js';
import {
  runGetAiFinancialSafetyMcpTool,
  runGetAiFinancialSnapshotMcpTool,
  runGetAiLiquidityMcpTool,
  runGetAiPipelineMcpTool,
  runGetAiRunwayMcpTool,
  runGetAiSnapshotMcpTool,
  runGetAiSpendByCurrencyMcpTool,
} from './bank-mcp-server.js';

/** Drop top-level `generatedAt` so two sequential composer runs compare stably. */
function withoutTopLevelGeneratedAt(body: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'generatedAt'));
}

describe('MCP get_ai_* tools match /api/ai composers (parameterized reads)', () => {
  beforeAll(async () => {
    await initDatabase();
  }, 120_000);

  afterAll(() => {
    closeDatabase();
  });

  it('get_ai_liquidity with empty object matches composeAiLiquidity defaults', () => {
    const expected = composeAiLiquidity({});
    const r = runGetAiLiquidityMcpTool({});
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toEqual(expected);
  });

  it('get_ai_liquidity rejects invalid groupByEntity string', () => {
    const r = runGetAiLiquidityMcpTool({ groupByEntity: 'maybe' });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text)).toMatchObject({ error: 'invalid-params' });
  });

  it('get_ai_pipeline {} matches composeAiPipeline with schema defaults', () => {
    const q = HorizonEntityQuerySchema.parse({});
    const expected = composeAiPipeline({ horizonDays: q.days, filterEntityId: q.entityId });
    const r = runGetAiPipelineMcpTool({});
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toEqual(expected);
  });

  it('get_ai_runway {} matches assembleRunway + runwayResponseFromAssembled with schema defaults', () => {
    const q = RunwayQuerySchema.parse({});
    const assembled = assembleRunway({ horizonDays: q.days, filterEntityId: q.entityId });
    const expected = runwayResponseFromAssembled(assembled, q.entityId, { detail: q.detail });
    const r = runGetAiRunwayMcpTool({});
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toEqual(expected);
  });

  it('get_ai_snapshot {} matches composeAiSnapshot with schema defaults', () => {
    const q = SnapshotQuerySchema.parse({});
    const expected = composeAiSnapshot({
      horizonDays: q.days,
      filterEntityId: q.entityId,
      runwayDetail: q.detail,
      account: q.account,
      financialYear: q.financialYear,
      groupByEntity: q.groupByEntity,
    });
    const r = runGetAiSnapshotMcpTool({});
    expect(r.isError).toBeUndefined();
    const sc = r.structuredContent;
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) {
      expect.fail('structuredContent missing');
    }
    expect(withoutTopLevelGeneratedAt(expected)).toEqual(withoutTopLevelGeneratedAt(sc));
  });

  it('get_ai_financial_snapshot {} matches composeAiFinancialSnapshot with schema defaults', () => {
    const q = FinancialSnapshotQuerySchema.parse({});
    const expected = composeAiFinancialSnapshot({
      horizonDays: q.days,
      commitmentDays: q.commitmentDays,
      filterEntityId: q.entityId,
      runwayDetail: q.detail,
      account: q.account,
      financialYear: q.financialYear,
      groupByEntity: q.groupByEntity,
    });
    const r = runGetAiFinancialSnapshotMcpTool({});
    expect(r.isError).toBeUndefined();
    const sc = r.structuredContent;
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) {
      expect.fail('structuredContent missing');
    }
    expect(withoutTopLevelGeneratedAt(expected)).toEqual(withoutTopLevelGeneratedAt(sc));
  });

  it(
    'get_ai_financial_safety {} matches composeAiFinancialSafety defaults (except timestamps)',
    () => {
      getDb().exec('DELETE FROM warning_snapshots;');
      const expected = composeAiFinancialSafety();
      getDb().exec('DELETE FROM warning_snapshots;');
      const r = runGetAiFinancialSafetyMcpTool({});
      expect(r.isError).toBeUndefined();
      const sc = r.structuredContent;
      if (typeof sc !== 'object' || sc === null) {
        expect.fail('structuredContent missing');
      }
      expect('score' in sc ? sc.score : undefined).toBe(expected.score);
      expect('formulaVersion' in sc ? sc.formulaVersion : undefined).toBe(expected.formulaVersion);
      expect('pillars' in sc ? sc.pillars : undefined).toEqual(expected.pillars);
      expect('warningAdjustment' in sc ? sc.warningAdjustment : undefined).toEqual(
        expected.warningAdjustment,
      );
      expect(
        'baseScoreBeforeWarnings' in sc ? sc.baseScoreBeforeWarnings : undefined,
      ).toBe(expected.baseScoreBeforeWarnings);
      expect('schemaVersion' in sc ? sc.schemaVersion : undefined).toBe(expected.schemaVersion);
      expect(typeof ('generatedAt' in sc ? sc.generatedAt : undefined)).toBe('string');
      const inputsRef =
        'inputsRef' in sc && typeof sc.inputsRef === 'object' && sc.inputsRef !== null
          ? sc.inputsRef
          : undefined;
      expect(
        inputsRef &&
          'financialSnapshotGeneratedAt' in inputsRef &&
          typeof inputsRef.financialSnapshotGeneratedAt === 'string',
      ).toBe(true);
    },
    25_000,
  );

  it('get_ai_spend_by_currency rejects when both calendarMonth and financialYear set', () => {
    const r = runGetAiSpendByCurrencyMcpTool({
      calendarMonth: '2026-01',
      financialYear: '2025',
    });
    expect(r.isError).toBe(true);
    const body = JSON.parse(r.content[0].text);
    expect(body.error).toBe('invalid-params');
  });

  it('get_ai_spend_by_currency matches composeAiSpendByCurrency for calendar month (excluding generatedAt)', () => {
    const args = { calendarMonth: '2026-03' as const };
    const expected = composeAiSpendByCurrency({
      period: { kind: 'calendarMonth', yearMonth: '2026-03' },
    });
    const r = runGetAiSpendByCurrencyMcpTool(args);
    expect(r.isError).toBeUndefined();
    const sc = r.structuredContent;
    expect(sc).toBeDefined();
    if (sc === undefined) {
      expect.fail('structuredContent missing');
    }
    const { generatedAt: _gt, ...withoutToolTime } = sc;
    const { generatedAt: _ge, ...withoutExpectedTime } = expected;
    expect(withoutToolTime).toEqual(withoutExpectedTime);
  });
});
