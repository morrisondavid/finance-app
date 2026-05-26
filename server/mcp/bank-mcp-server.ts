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
  AiLiquidityResponseSchema,
  AiPipelineResponseSchema,
  RunwayResponseSchema,
  AiSnapshotResponseSchema,
  AiFinancialSnapshotResponseSchema,
  AiFinancialSafetyResponseSchema,
  AiSpendByCurrencyResponseSchema,
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
  composeAiSpendByCurrency,
  composeAiEntityLiquidityFx,
  buildAiTransactionDrillResponse,
} from '../domain/ai/index.js';
import type { SpendByCurrencyPeriod } from '../domain/cross-currency/spend-by-currency.js';
import {
  FinancialSnapshotQuerySchema,
  HorizonEntityQuerySchema,
  LiquidityQuerySchema,
  RunwayQuerySchema,
  SnapshotQuerySchema,
  SpendByCurrencyQuerySchema,
} from '../domain/ai/ai-get-query-schemas.js';
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

const MCPParameterizedToolForResourceKey: Partial<
  Record<keyof typeof BankStatementsAiResourceUris, string>
> = {
  liquidity: 'get_ai_liquidity',
  pipeline: 'get_ai_pipeline',
  runway: 'get_ai_runway',
  snapshot: 'get_ai_snapshot',
  'financial-snapshot': 'get_ai_financial_snapshot',
  'financial-safety': 'get_ai_financial_safety',
  spendByCurrency: 'get_ai_spend_by_currency',
};

type McpJsonToolReturn = {
  [x: string]: unknown;
  isError?: true;
  content: { type: 'text'; text: string }[];
  structuredContent?: { [x: string]: unknown };
};

function mcpAiInvalidParams(issues: z.ZodIssue[]): McpJsonToolReturn {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: 'invalid-params', issues }, null, 2) }],
  };
}

function mcpAiInternalError(message: string): McpJsonToolReturn {
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: JSON.stringify({ error: 'internal-error', message }, null, 2) },
    ],
  };
}

/** @internal Exported for MCP contract tests. */
export function runGetAiLiquidityMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = LiquidityQuerySchema.safeParse(args);
  if (!parsed.success) return mcpAiInvalidParams(parsed.error.issues);
  try {
    const structuredContent = AiLiquidityResponseSchema.parse(composeAiLiquidity(parsed.data));
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  } catch (err) {
    return mcpAiInternalError(err instanceof Error ? err.message : 'Unknown error');
  }
}

/** @internal */
export function runGetAiPipelineMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = HorizonEntityQuerySchema.safeParse(args);
  if (!parsed.success) return mcpAiInvalidParams(parsed.error.issues);
  try {
    const { days: horizonDays, entityId: filterEntityId } = parsed.data;
    const structuredContent = AiPipelineResponseSchema.parse(
      composeAiPipeline({ horizonDays, filterEntityId }),
    );
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  } catch (err) {
    return mcpAiInternalError(err instanceof Error ? err.message : 'Unknown error');
  }
}

/** @internal */
export function runGetAiRunwayMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = RunwayQuerySchema.safeParse(args);
  if (!parsed.success) return mcpAiInvalidParams(parsed.error.issues);
  try {
    const { days: horizonDays, entityId: filterEntityId, detail } = parsed.data;
    const assembled = assembleRunway({ horizonDays, filterEntityId });
    const structuredContent = RunwayResponseSchema.parse(
      runwayResponseFromAssembled(assembled, filterEntityId, { detail }),
    );
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  } catch (err) {
    return mcpAiInternalError(err instanceof Error ? err.message : 'Unknown error');
  }
}

/** @internal */
export function runGetAiSnapshotMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = SnapshotQuerySchema.safeParse(args);
  if (!parsed.success) return mcpAiInvalidParams(parsed.error.issues);
  try {
    const {
      days: horizonDays,
      entityId: filterEntityId,
      detail: runwayDetail,
      account,
      financialYear,
      groupByEntity,
    } = parsed.data;
    const structuredContent = AiSnapshotResponseSchema.parse(
      composeAiSnapshot({
        horizonDays,
        filterEntityId,
        runwayDetail,
        account,
        financialYear,
        groupByEntity,
      }),
    );
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  } catch (err) {
    return mcpAiInternalError(err instanceof Error ? err.message : 'Unknown error');
  }
}

/** @internal */
export function runGetAiFinancialSnapshotMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = FinancialSnapshotQuerySchema.safeParse(args);
  if (!parsed.success) return mcpAiInvalidParams(parsed.error.issues);
  try {
    const {
      days: horizonDays,
      entityId: filterEntityId,
      detail: runwayDetail,
      account,
      financialYear,
      groupByEntity,
      commitmentDays,
    } = parsed.data;
    const structuredContent = AiFinancialSnapshotResponseSchema.parse(
      composeAiFinancialSnapshot({
        horizonDays,
        commitmentDays,
        filterEntityId,
        runwayDetail,
        account,
        financialYear,
        groupByEntity,
      }),
    );
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  } catch (err) {
    return mcpAiInternalError(err instanceof Error ? err.message : 'Unknown error');
  }
}

/** @internal */
export function runGetAiFinancialSafetyMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = FinancialSnapshotQuerySchema.safeParse(args);
  if (!parsed.success) return mcpAiInvalidParams(parsed.error.issues);
  try {
    const {
      days: horizonDays,
      entityId: filterEntityId,
      detail: runwayDetail,
      account,
      financialYear,
      groupByEntity,
      commitmentDays,
    } = parsed.data;
    const structuredContent = AiFinancialSafetyResponseSchema.parse(
      composeAiFinancialSafety({
        horizonDays,
        commitmentDays,
        filterEntityId,
        runwayDetail,
        account,
        financialYear,
        groupByEntity,
      }),
    );
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  } catch (err) {
    return mcpAiInternalError(err instanceof Error ? err.message : 'Unknown error');
  }
}

function spendPeriodFromValidated(data: z.infer<typeof SpendByCurrencyQuerySchema>): SpendByCurrencyPeriod {
  if (data.calendarMonth !== undefined) {
    return { kind: 'calendarMonth', yearMonth: data.calendarMonth };
  }
  return { kind: 'financialYear', financialYear: data.financialYear! };
}

/** @internal */
export function runGetAiSpendByCurrencyMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = SpendByCurrencyQuerySchema.safeParse(args);
  if (!parsed.success) return mcpAiInvalidParams(parsed.error.issues);
  try {
    const { entityId, account } = parsed.data;
    const period = spendPeriodFromValidated(parsed.data);
    const structuredContent = AiSpendByCurrencyResponseSchema.parse(
      composeAiSpendByCurrency({
        period,
        entityId,
        account,
      }),
    );
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  } catch (err) {
    return mcpAiInternalError(err instanceof Error ? err.message : 'Unknown error');
  }
}

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
        '§2.0 AI over bank-statements-app. **Parameterized GET parity (Hermes MCP tools):** get_ai_liquidity, get_ai_pipeline, get_ai_runway, get_ai_snapshot, get_ai_financial_snapshot, get_ai_financial_safety, get_ai_spend_by_currency — same Zod/query semantics as GET /api/ai/* (see server/domain/ai/ai-get-query-schemas.ts and AI manifest slice `mcpTool`). **Legacy resources:** bankstatements://ai/{liquidity,pipeline,runway,snapshot,financial-snapshot,financial-safety,spend-by-currency} remain fixed-default snapshots for backward compat; prefer the matching `get_ai_*` tool for filters (e.g. spend-by-currency resource = current calendar month only). Other tools: capture_net_worth_snapshot (§3.1); sync_bank_feed (§3.4); query_transactions (GET /api/ai/transactions-drill parity). Transaction drill: `account` optional; transfer rows omitted by default cross-account unless `type`/`includeTransfers` apply; multi-currency requires per-currency aggregates. Prefer `account` when the user names one bank/card. entity-liquidity-fx resource matches GET /api/ai/entity-liquidity-fx.',
    },
  );

  const jsonMeta = {
    mimeType: 'application/json',
  } as const;

  for (const [key, resourceUri] of Object.entries(BankStatementsAiResourceUris) as [
    keyof typeof BankStatementsAiResourceUris,
    string,
  ][]) {
    const mcpParameterized = MCPParameterizedToolForResourceKey[key];
    const description =
      mcpParameterized !== undefined
        ? `Legacy fixed-default snapshot matching the same composer family as GET /api/ai/${String(key)}. Prefer MCP tool "${mcpParameterized}" for full HTTP query parity (see AI manifest slice mcpTool).`
        : `Same payload as the matching GET /api/ai/${String(key)} composer.`;
    server.registerResource(
      `ai-${String(key)}`,
      resourceUri,
      {
        ...jsonMeta,
        description,
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

  server.registerTool(
    'get_ai_liquidity',
    {
      description:
        '§2.0 — GET /api/ai/liquidity parity. Optional account, financialYear, groupByEntity (boolean or "true"/"false").',
      inputSchema: LiquidityQuerySchema.shape,
      outputSchema: AiLiquidityResponseSchema.shape,
    },
    args => runGetAiLiquidityMcpTool(args),
  );

  server.registerTool(
    'get_ai_pipeline',
    {
      description: '§2.0 — GET /api/ai/pipeline parity. days (default 720), optional entityId.',
      inputSchema: HorizonEntityQuerySchema.shape,
      outputSchema: AiPipelineResponseSchema.shape,
    },
    args => runGetAiPipelineMcpTool(args),
  );

  server.registerTool(
    'get_ai_runway',
    {
      description:
        '§2.0 — GET /api/ai/runway parity. days (default 720), optional entityId, detail accounts|summary (default summary).',
      inputSchema: RunwayQuerySchema.shape,
      outputSchema: RunwayResponseSchema.shape,
    },
    args => runGetAiRunwayMcpTool(args),
  );

  server.registerTool(
    'get_ai_snapshot',
    {
      description:
        '§2.0 — GET /api/ai/snapshot parity. Merges runway + liquidity query params (days, entityId, detail, account, financialYear, groupByEntity).',
      inputSchema: SnapshotQuerySchema.shape,
      outputSchema: AiSnapshotResponseSchema.shape,
    },
    args => runGetAiSnapshotMcpTool(args),
  );

  server.registerTool(
    'get_ai_financial_snapshot',
    {
      description:
        '§2.0 — GET /api/ai/financial-snapshot parity. Same as snapshot inputs plus commitmentDays (default 90).',
      inputSchema: FinancialSnapshotQuerySchema.shape,
      outputSchema: AiFinancialSnapshotResponseSchema.shape,
    },
    args => runGetAiFinancialSnapshotMcpTool(args),
  );

  server.registerTool(
    'get_ai_financial_safety',
    {
      description:
        '§2.0 — GET /api/ai/financial-safety parity. Same inputs as get_ai_financial_snapshot (FinancialSnapshot query).',
      inputSchema: FinancialSnapshotQuerySchema.shape,
      outputSchema: AiFinancialSafetyResponseSchema.shape,
    },
    args => runGetAiFinancialSafetyMcpTool(args),
  );

  server.registerTool(
    'get_ai_spend_by_currency',
    {
      description:
        '§2.0 — GET /api/ai/spend-by-currency parity. Exactly one of calendarMonth (YYYY-MM) or financialYear; optional entityId, account.',
      inputSchema: SpendByCurrencyQuerySchema.shape,
      outputSchema: AiSpendByCurrencyResponseSchema.shape,
    },
    args => runGetAiSpendByCurrencyMcpTool(args),
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
