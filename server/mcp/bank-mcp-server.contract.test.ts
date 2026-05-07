import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase } from '../db/index.js';
import {
  composeAiLiquidity,
  composeAiPipeline,
  composeAiSnapshot,
  buildAiManifest,
  composeAiIncomeComposition,
  composeAiDebtStrategyState,
  composeAiSpendContext,
} from '../domain/ai/index.js';
import { assembleRunway } from '../domain/forecast/index.js';
import { runwayResponseFromAssembled } from '../domain/forecast/runway-api-response.js';
import { buildConsolidatedWarningsResponse } from '../domain/warnings/consolidated-feed.js';
import { getDb } from '../db/connection.js';
import {
  BankStatementsAiResourceUris,
  readBankStatementsAiResource,
} from './bank-mcp-server.js';

describe('MCP resource payloads vs composers', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('liquidity resource matches composeAiLiquidity', () => {
    const fromMcp = JSON.parse(readBankStatementsAiResource(BankStatementsAiResourceUris.liquidity));
    expect(fromMcp).toEqual(composeAiLiquidity());
  });

  it('pipeline resource matches composeAiPipeline', () => {
    const fromMcp = JSON.parse(readBankStatementsAiResource(BankStatementsAiResourceUris.pipeline));
    expect(fromMcp).toEqual(composeAiPipeline());
  });

  it('runway resource matches default assembleRunway + runwayResponseFromAssembled', () => {
    const assembled = assembleRunway({ horizonDays: 720 });
    const expected = runwayResponseFromAssembled(assembled, undefined, { detail: 'summary' });
    const fromMcp = JSON.parse(readBankStatementsAiResource(BankStatementsAiResourceUris.runway));
    expect(fromMcp).toEqual(expected);
  });

  it('snapshot resource matches composeAiSnapshot with defaults', () => {
    const fromMcp = JSON.parse(readBankStatementsAiResource(BankStatementsAiResourceUris.snapshot));
    const expected = composeAiSnapshot();
    expect(fromMcp.liquidity).toEqual(expected.liquidity);
    expect(fromMcp.pipeline).toEqual(expected.pipeline);
    expect(fromMcp.runway).toEqual(expected.runway);
    expect(fromMcp.schemaVersion).toBe(expected.schemaVersion);
  });

  it('manifest resource matches buildAiManifest', () => {
    const fromMcp = JSON.parse(readBankStatementsAiResource(BankStatementsAiResourceUris.manifest));
    expect(fromMcp).toEqual(buildAiManifest());
  });

  it('warnings resource matches buildConsolidatedWarningsResponse', () => {
    getDb().exec('DELETE FROM warning_snapshots;');
    const fromMcp = JSON.parse(readBankStatementsAiResource(BankStatementsAiResourceUris.warnings));
    getDb().exec('DELETE FROM warning_snapshots;');
    expect(buildConsolidatedWarningsResponse(getDb())).toEqual(fromMcp);
  });

  it('income-composition resource matches composeAiIncomeComposition', () => {
    const fromMcp = JSON.parse(
      readBankStatementsAiResource(BankStatementsAiResourceUris.incomeComposition),
    );
    expect(fromMcp).toEqual(composeAiIncomeComposition());
  });

  it('debt-strategy resource matches composeAiDebtStrategyState', () => {
    const fromMcp = JSON.parse(
      readBankStatementsAiResource(BankStatementsAiResourceUris.debtStrategy),
    );
    expect(fromMcp).toEqual(composeAiDebtStrategyState());
  });

  it('spend-context resource matches composeAiSpendContext', () => {
    const fromMcp = JSON.parse(
      readBankStatementsAiResource(BankStatementsAiResourceUris.spendContext),
    );
    expect(fromMcp).toEqual(composeAiSpendContext());
  });
});
