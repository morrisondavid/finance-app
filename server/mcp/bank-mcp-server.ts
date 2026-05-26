/**
 * MCP server registration for §2.0.G — resources call the same composers as
 * `GET /api/ai/*` (no duplicated field math).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  NetWorthSnapshotCaptureResponseSchema,
  FeedSyncBodySchema,
  FeedSyncResponseSchema,
  AiTransactionDrillQuerySchema,
  AiTransactionDrillResponseSchema,
} from '../../shared/api-contracts.js';
import { getDb } from '../db/connection.js';
import { runFeedSync, FeedSyncError } from '../ingestion/feeds/sync.js';
import { EnableBankingError } from '../ingestion/feeds/enable-banking.js';
import { TrueLayerError } from '../ingestion/feeds/truelayer/truelayer-error.js';
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
  composeAiSpendByCurrencyForCurrentMonth,
  composeAiEntityLiquidityFx,
  buildAiTransactionDrillResponse,
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
  spendByCurrency: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/spend-by-currency`,
  entityLiquidityFx: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/entity-liquidity-fx`,
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
    case BankStatementsAiResourceUris.spendByCurrency:
      return JSON.stringify(composeAiSpendByCurrencyForCurrentMonth());
    case BankStatementsAiResourceUris.entityLiquidityFx:
      return JSON.stringify(composeAiEntityLiquidityFx());
    default:
      throw new Error(`Unknown MCP resource uri: ${uri}`);
  }
}

export function createBankStatementsMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'bank-statements-ai', version: '2.0.0' },
    {
      instructions:
        'AI slices over the bank-statements-app domain (§2.0): read resources mirror GET /api/ai/*. Tools: capture_net_worth_snapshot (§3.1); sync_bank_feed (§3.4 feed sync); query_transactions (transaction drill, same as GET /api/ai/transactions-drill). For query_transactions: `account` is optional — omit to search all ledger accounts; then transfer rows are excluded by default unless you set `type` or use `includeTransfers` with a specific `account`. Per-account currency is in response aggregates; do not sum across different currencies as one number without FX. Prefer `account` when the user names one bank/card. §3.2: bankstatements://ai/spend-by-currency uses the current calendar month only; for financial-year, entity, or account filters use GET /api/ai/spend-by-currency. entity-liquidity-fx matches GET /api/ai/entity-liquidity-fx.',
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

  // §3.4 — sync_bank_feed mirrors `POST /api/feed/sync`.
  // Same Zod input/output schemas; same `runFeedSync` engine. The MCP
  // surface differs only in the error envelope (we set `isError: true`
  // and embed a structured error body) — the route maps the same errors
  // to HTTP status codes.
  server.registerTool(
    'sync_bank_feed',
    {
      description:
        '§3.4 — fetch new transactions from the configured AISP (TrueLayer preferred when linked, else Enable Banking) for one account, emit bank-shaped CSV, and run the same ingest pipeline as a manual upload. dateFrom is required; dateTo defaults to today; force=true overwrites an existing original of the same generated name.',
      inputSchema: FeedSyncBodySchema.shape,
      outputSchema: FeedSyncResponseSchema.shape,
    },
    args => runSyncBankFeedMcpTool(args),
  );

  server.registerTool(
    'query_transactions',
    {
      description:
        'Wave 03 — same composer as GET /api/ai/transactions-drill. **`account` optional**: omit to match all ledger accounts (no `AND account` in SQL). **Transfers**: with no `account`, default behaviour excludes `transfer` rows unless you set `type` (`income`/`expense`/`transfer`); `includeTransfers` only expands income/expense with transfers when **`account`** is a valid account id. **Prefer `account`** when the user names a specific bank/card. **Totals**: use `totalsByCurrency` / `aggregatesByAccount` — each has `currency`; do not add across mixed currencies without FX. **Merchant modal**: `merchantModalLabel` implies expense-type drill; cross-account drills do not get per-account transfer-as-expense expansion. Exactly one date window. Never both `search` and `merchantModalLabel`. `includeRows:false` returns aggregates only.',
      inputSchema: AiTransactionDrillQuerySchema.shape,
      outputSchema: AiTransactionDrillResponseSchema.shape,
    },
    async args => runQueryTransactionsMcpTool(args),
  );

  return server;
}

/**
 * Exported handler for the `query_transactions` MCP tool. Validates with the
 * same Zod schema as GET /api/ai/transactions-drill; malformed input returns
 * `isError: true` (unlike §3.4 feed errors, which distinguish adapter failures).
 *
 * **Optional `account`:** see **`AiTransactionDrillQuerySchema`** (shared/api-contracts) and the
 * registered tool `description` / server `instructions` for cross-account transfer defaults and
 * multi-currency aggregates.
 */
export function runQueryTransactionsMcpTool(args: unknown): {
  [x: string]: unknown;
  isError?: true;
  content: { type: 'text'; text: string }[];
  structuredContent?: import('../../shared/api-contracts.js').AiTransactionDrillResponse;
} {
  const parsed = AiTransactionDrillQuerySchema.safeParse(args);
  if (!parsed.success) {
    const body = { error: 'invalid-params', issues: parsed.error.issues };
    return {
      isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
    };
  }

  const structuredContent = AiTransactionDrillResponseSchema.parse(
    buildAiTransactionDrillResponse(parsed.data),
  );
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

/**
 * Exported handler for the `sync_bank_feed` MCP tool. Lives outside
 * `createBankStatementsMcpServer` so tests (and any future direct
 * caller) can invoke it without spinning up an MCP transport.
 *
 * Mirrors the §3.4 plan: same Zod parse + same `runFeedSync` engine
 * the HTTP route uses; the only difference is the MCP error envelope
 * (`isError: true` + structured `{ code, message }` body) instead of
 * an HTTP status code.
 *
 * Returned shape is `unknown`-indexed (per the MCP SDK's tool callback
 * signature); callers that want the typed payload should read the
 * `structuredContent` field which is parsed against
 * `FeedSyncResponseSchema`.
 */
export async function runSyncBankFeedMcpTool(
  args: import('../../shared/api-contracts.js').FeedSyncBody,
): Promise<{
  [x: string]: unknown;
  isError?: true;
  content: { type: 'text'; text: string }[];
  structuredContent?: import('../../shared/api-contracts.js').FeedSyncResponse;
}> {
  try {
    const result = await runFeedSync(args.account, {
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      force: args.force,
    });
    const structuredContent = FeedSyncResponseSchema.parse(result);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  } catch (err) {
    const code =
      err instanceof FeedSyncError || err instanceof EnableBankingError || err instanceof TrueLayerError
        ? err.code
        : 'internal-error';
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ code, message }, null, 2),
        },
      ],
    };
  }
}
