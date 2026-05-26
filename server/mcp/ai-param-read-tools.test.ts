import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase } from '../db/index.js';
import { composeAiLiquidity, composeAiSpendByCurrency } from '../domain/ai/index.js';
import {
  runGetAiLiquidityMcpTool,
  runGetAiSpendByCurrencyMcpTool,
} from './bank-mcp-server.js';

describe('MCP Phase A — parameterized AI read tools', () => {
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
