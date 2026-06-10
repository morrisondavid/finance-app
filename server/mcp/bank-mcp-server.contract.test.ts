import { describe, it, expect } from 'vitest';
import {
  type EntityFoundationWarning,
  type AiTransactionDrillResponse,
  AiTransactionDrillQuerySchema,
} from '../../shared/api-contracts.js';
import { usePopulatedIntegrationDatabase } from '../db/test-harness/use-populated-integration-db.js';
import {
  composeAiLiquidity,
  composeAiPipeline,
  composeAiSnapshot,
  composeAiFinancialSnapshot,
  composeAiFinancialSafety,
  composeAiAvailableFunds,
  buildAiManifest,
  composeAiIncomeComposition,
  composeAiDebtStrategyState,
  composeAiSpendContext,
  composeAiNetWorthHistory,
  composeAiSpendByCurrencyForCurrentMonth,
  composeAiEntityLiquidityFx,
  buildAiTransactionDrillResponse,
} from '../domain/ai/index.js';
import { assembleRunway } from '../domain/forecast/index.js';
import { runwayResponseFromAssembled } from '../domain/forecast/runway-api-response.js';
import { buildConsolidatedWarningsResponse } from '../domain/warnings/consolidated-feed.js';
import { getDb } from '../db/connection.js';
import {
  BankStatementsAiResourceUris,
  readBankStatementsAiResource,
  runQueryTransactionsMcpTool,
} from './bank-mcp-server.js';

function stripTransactionDrillGeneratedAt(body: AiTransactionDrillResponse) {
  const { generatedAt: _g, ...rest } = body;
  return rest;
}

function warningsIgnoringTimeline(warnings: readonly EntityFoundationWarning[]) {
  return warnings.map(w => {
    const { firstSeenAt: _fs, lastActiveAt: _la, ...rest } = w;
    return rest;
  });
}

describe('MCP resource payloads vs composers', () => {
  usePopulatedIntegrationDatabase(import.meta.url);

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

  it('financial-snapshot resource matches composeAiFinancialSnapshot with defaults', () => {
    const fromMcp = JSON.parse(
      readBankStatementsAiResource(BankStatementsAiResourceUris['financial-snapshot']),
    );
    const expected = composeAiFinancialSnapshot();
    expect(fromMcp.liquidity).toEqual(expected.liquidity);
    expect(fromMcp.runway).toEqual(expected.runway);
    expect(fromMcp.commitmentWindow).toEqual(expected.commitmentWindow);
    expect(fromMcp.income).toEqual(expected.income);
    expect(typeof fromMcp.income.earnedReceivablesGbp).toBe('number');
    expect(typeof fromMcp.income.retainedAccruedToDateGbp).toBe('number');
    expect(fromMcp.discretionary).toEqual(expected.discretionary);
    expect(fromMcp.spendVsBudget).toEqual(expected.spendVsBudget);
    expect(fromMcp.verdict).toEqual(expected.verdict);
    expect(fromMcp.schemaVersion).toBe(expected.schemaVersion);
  });

  it('available-funds resource matches composeAiAvailableFunds with defaults (except generatedAt)', () => {
    const fromMcp = JSON.parse(
      readBankStatementsAiResource(BankStatementsAiResourceUris.availableFunds),
    );
    const expected = composeAiAvailableFunds();
    expect(fromMcp.futureIncomeByMonth).toEqual(expected.futureIncomeByMonth);
    expect(fromMcp.futureIncomeByClient).toEqual(expected.futureIncomeByClient);
    expect(fromMcp.lastContractPayment).toEqual(expected.lastContractPayment);
    expect(fromMcp.committedOutflows).toEqual(expected.committedOutflows);
    expect(fromMcp.totalFundsGbp).toBe(expected.totalFundsGbp);
    expect(fromMcp.confirmedFutureIncomeRetainedGbp).toBe(expected.confirmedFutureIncomeRetainedGbp);
    expect(fromMcp.schemaVersion).toBe(expected.schemaVersion);
  });

  it(
    'financial-safety resource matches composeAiFinancialSafety with defaults (except timestamps)',
    () => {
      getDb().exec('DELETE FROM warning_snapshots;');
      const expected = composeAiFinancialSafety();
      getDb().exec('DELETE FROM warning_snapshots;');
      const fromMcp = JSON.parse(
        readBankStatementsAiResource(BankStatementsAiResourceUris['financial-safety']),
      );
      expect(fromMcp.score).toBe(expected.score);
      expect(fromMcp.formulaVersion).toBe(expected.formulaVersion);
      expect(fromMcp.pillars).toEqual(expected.pillars);
      expect(fromMcp.warningAdjustment).toEqual(expected.warningAdjustment);
      expect(fromMcp.baseScoreBeforeWarnings).toBe(expected.baseScoreBeforeWarnings);
      expect(fromMcp.schemaVersion).toBe(expected.schemaVersion);
      expect(typeof fromMcp.generatedAt).toBe('string');
      expect(fromMcp.inputsRef?.financialSnapshotGeneratedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    },
    25_000,
  );

  it('manifest resource matches buildAiManifest', () => {
    const fromMcp = JSON.parse(readBankStatementsAiResource(BankStatementsAiResourceUris.manifest));
    expect(fromMcp).toEqual(buildAiManifest());
  });

  it('warnings resource matches buildConsolidatedWarningsResponse', () => {
    getDb().exec('DELETE FROM warning_snapshots;');
    const fromMcp = JSON.parse(readBankStatementsAiResource(BankStatementsAiResourceUris.warnings));
    getDb().exec('DELETE FROM warning_snapshots;');
    const fromComposer = buildConsolidatedWarningsResponse(getDb());
    expect(warningsIgnoringTimeline(fromComposer.warnings)).toEqual(
      warningsIgnoringTimeline(fromMcp.warnings),
    );
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

  it('net-worth-history resource matches composeAiNetWorthHistory (except generatedAt)', () => {
    const fromMcp = JSON.parse(
      readBankStatementsAiResource(BankStatementsAiResourceUris.netWorthHistory),
    );
    const expected = composeAiNetWorthHistory();
    expect(fromMcp.schemaVersion).toBe(expected.schemaVersion);
    expect(fromMcp.snapshots).toEqual(expected.snapshots);
  });

  it('spend-by-currency resource matches composeAiSpendByCurrencyForCurrentMonth (except generatedAt)', () => {
    const fromMcp = JSON.parse(
      readBankStatementsAiResource(BankStatementsAiResourceUris.spendByCurrency),
    );
    const expected = composeAiSpendByCurrencyForCurrentMonth();
    expect(fromMcp.period).toEqual(expected.period);
    expect(fromMcp.schemaVersion).toBe(expected.schemaVersion);
    expect(fromMcp.totalsByCurrency).toEqual(expected.totalsByCurrency);
    expect(fromMcp.filters).toEqual(expected.filters);
    expect(fromMcp.fxNote).toBe(expected.fxNote);
  });

  it('entity-liquidity-fx resource matches composeAiEntityLiquidityFx (except generatedAt)', () => {
    const fromMcp = JSON.parse(
      readBankStatementsAiResource(BankStatementsAiResourceUris.entityLiquidityFx),
    );
    const expected = composeAiEntityLiquidityFx();
    expect(fromMcp.schemaVersion).toBe(expected.schemaVersion);
    expect(fromMcp.asOf).toBe(expected.asOf);
    expect(fromMcp.global).toEqual(expected.global);
    expect(fromMcp.byEntity).toEqual(expected.byEntity);
  });

  it('query_transactions matches buildAiTransactionDrillResponse (excluding generatedAt)', () => {
    const q = AiTransactionDrillQuerySchema.parse({
      year: '2099',
      includeRows: false,
      limit: 10,
    });
    const composed = buildAiTransactionDrillResponse(q);
    const fromTool = runQueryTransactionsMcpTool(q);
    expect(fromTool.isError).toBeUndefined();
    expect(stripTransactionDrillGeneratedAt(fromTool.structuredContent!)).toEqual(
      stripTransactionDrillGeneratedAt(composed),
    );
  });
});
