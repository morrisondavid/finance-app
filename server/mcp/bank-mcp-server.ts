/**
 * MCP server registration for §2.0.G — resources call the same composers as
 * `GET /api/ai/*` (no duplicated field math).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NetWorthSnapshotCaptureResponseSchema } from '../../shared/api-contracts.js';
import { getDb } from '../db/connection.js';
import {
  composeAiLiquidity,
  composeAiPipeline,
  composeAiSnapshot,
  composeAiFinancialSnapshot,
  composeAiFinancialSafety,
  buildAiManifest,
  composeAiIncomeComposition,
  composeAiDebtStrategyState,
  composeAiSpendContext,
  composeAiNetWorthHistory,
} from '../domain/ai/index.js';
import { assembleRunway } from '../domain/forecast/index.js';
import { runwayResponseFromAssembled } from '../domain/forecast/runway-api-response.js';
import { buildConsolidatedWarningsResponse } from '../domain/warnings/consolidated-feed.js';
import { captureNetWorthSnapshots } from '../domain/net-worth/snapshot.js';

export const BANK_STATEMENTS_AI_RESOURCE_BASE = 'bankstatements://ai';

export const BankStatementsAiResourceUris = {
  liquidity: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/liquidity`,
  pipeline: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/pipeline`,
  runway: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/runway`,
  snapshot: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/snapshot`,
  'financial-snapshot': `${BANK_STATEMENTS_AI_RESOURCE_BASE}/financial-snapshot`,
  'financial-safety': `${BANK_STATEMENTS_AI_RESOURCE_BASE}/financial-safety`,
  manifest: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/manifest`,
  warnings: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/warnings`,
  incomeComposition: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/income-composition`,
  debtStrategy: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/debt-strategy`,
  spendContext: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/spend-context`,
  netWorthHistory: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/net-worth-history`,
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
    case BankStatementsAiResourceUris['financial-snapshot']:
      return JSON.stringify(composeAiFinancialSnapshot());
    case BankStatementsAiResourceUris['financial-safety']:
      return JSON.stringify(composeAiFinancialSafety());
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
    case BankStatementsAiResourceUris.netWorthHistory:
      return JSON.stringify(composeAiNetWorthHistory());
    default:
      throw new Error(`Unknown MCP resource uri: ${uri}`);
  }
}

export function createBankStatementsMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'bank-statements-ai', version: '2.0.0' },
    {
      instructions:
        'AI slices over the bank-statements-app domain (§2.0): read resources mirror GET /api/ai/*. Tool capture_net_worth_snapshot (§3.1) appends/updates canonical net-worth CSV — same primitive as POST /api/ai/net-worth/snapshot.',
    },
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

  server.registerTool(
    'capture_net_worth_snapshot',
    {
      description:
        '§3.1 — compute and upsert net-worth rows for the current period (weekly by default, or daily if NET_WORTH_SNAPSHOT_CADENCE=daily). Uses force:true to replace the current period even if already captured.',
      inputSchema: {
        force: z.boolean().optional().describe('If true, replace rows for the current period even when already captured'),
        snapshotDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Override as-of date (ISO yyyy-mm-dd); default is local today'),
      },
      outputSchema: {
        skipped: z.boolean(),
        reason: z.string().optional(),
        periodKey: z.string(),
        snapshotDate: z.string(),
        cadence: z.enum(['weekly', 'daily']),
        rowsWritten: z.number(),
      },
    },
    async args => {
      const structuredContent = NetWorthSnapshotCaptureResponseSchema.parse(
        captureNetWorthSnapshots({
          force: args.force,
          snapshotDate: args.snapshotDate,
        }),
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
      };
    },
  );

  return server;
}
