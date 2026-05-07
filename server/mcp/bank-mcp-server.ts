/**
 * MCP server registration for §2.0.G — resources call the same composers as
 * `GET /api/ai/*` (no duplicated field math).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../db/connection.js';
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

export const BANK_STATEMENTS_AI_RESOURCE_BASE = 'bankstatements://ai';

export const BankStatementsAiResourceUris = {
  liquidity: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/liquidity`,
  pipeline: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/pipeline`,
  runway: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/runway`,
  snapshot: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/snapshot`,
  manifest: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/manifest`,
  warnings: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/warnings`,
  incomeComposition: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/income-composition`,
  debtStrategy: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/debt-strategy`,
  spendContext: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/spend-context`,
} as const;

export type BankStatementsAiResourceUri =
  (typeof BankStatementsAiResourceUris)[keyof typeof BankStatementsAiResourceUris];

/** In-process resource reader — MCP callbacks and tests share this. */
export function readBankStatementsAiResource(uri: string): string {
  switch (uri) {
    case BankStatementsAiResourceUris.liquidity:
      return JSON.stringify(composeAiLiquidity());
    case BankStatementsAiResourceUris.pipeline:
      return JSON.stringify(composeAiPipeline());
    case BankStatementsAiResourceUris.runway: {
      const assembled = assembleRunway({ horizonDays: 720 });
      return JSON.stringify(runwayResponseFromAssembled(assembled, undefined, { detail: 'summary' }));
    }
    case BankStatementsAiResourceUris.snapshot:
      return JSON.stringify(composeAiSnapshot());
    case BankStatementsAiResourceUris.manifest:
      return JSON.stringify(buildAiManifest());
    case BankStatementsAiResourceUris.warnings:
      return JSON.stringify(buildConsolidatedWarningsResponse(getDb()));
    case BankStatementsAiResourceUris.incomeComposition:
      return JSON.stringify(composeAiIncomeComposition());
    case BankStatementsAiResourceUris.debtStrategy:
      return JSON.stringify(composeAiDebtStrategyState());
    case BankStatementsAiResourceUris.spendContext:
      return JSON.stringify(composeAiSpendContext());
    default:
      throw new Error(`Unknown MCP resource uri: ${uri}`);
  }
}

export function createBankStatementsMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'bank-statements-ai', version: '2.0.0' },
    { instructions: 'Read-only AI slices over the bank-statements-app domain (§2.0).' },
  );

  const jsonMeta = {
    mimeType: 'application/json',
  } as const;

  for (const [key, resourceUri] of Object.entries(BankStatementsAiResourceUris) as [
    keyof typeof BankStatementsAiResourceUris,
    string,
  ][]) {
    server.registerResource(
      `ai-${key}`,
      resourceUri,
      {
        ...jsonMeta,
        description: `Same payload as the matching GET /api/ai/${key} composer.`,
      },
      async () => ({
        contents: [
          {
            uri: resourceUri,
            mimeType: 'application/json',
            text: readBankStatementsAiResource(resourceUri),
          },
        ],
      }),
    );
  }

  return server;
}
