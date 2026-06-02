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
  AiSpendRateResponseSchema,
  AiAvailableFundsResponseSchema,
  AiUpcomingResponseSchema,
  AiSurvivalResponseSchema,
  AiSpendAllowanceResponseSchema,
  HouseholdFinancialPostureResponseSchema,
  IncomeCompositionResponseSchema,
  AccountBalanceSchema,
  type AccountBalance,
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
  composeAiSpendRate,
  composeAiAvailableFunds,
  composeAiUpcoming,
  composeAiSurvival,
  composeAiSpendAllowance,
  composeHouseholdSpendDeltas,
  buildAiTransactionDrillResponse,
} from '../domain/ai/index.js';
import { loadForecastInputs } from '../domain/forecast/load-inputs.js';
import type { SpendByCurrencyPeriod } from '../domain/cross-currency/spend-by-currency.js';
import {
  FinancialSnapshotQuerySchema,
  HorizonEntityQuerySchema,
  LiquidityQuerySchema,
  RunwayQuerySchema,
  SnapshotQuerySchema,
  SpendByCurrencyQuerySchema,
  SpendRateQuerySchema,
  AvailableFundsQuerySchema,
  UpcomingQuerySchema,
  SurvivalQuerySchema,
  SpendAllowanceQuerySchema,
  HouseholdFinancialPostureQuerySchema,
} from '../domain/ai/ai-get-query-schemas.js';
import { assembleRunway } from '../domain/forecast/index.js';
import { runwayResponseFromAssembled } from '../domain/forecast/runway-api-response.js';
import { buildConsolidatedWarningsResponse } from '../domain/warnings/consolidated-feed.js';
import { captureNetWorthSnapshots } from '../domain/net-worth/snapshot.js';

import { readDashboardSummaryFromQuery, readDashboardBalance } from '../http/read/dashboard.js';
import { ACCOUNTS } from '../types.js';
import { registerBankStatementsHttpJsonReadTools } from './http-json-read-mcp-tools.js';
import { registerBankStatementsHttpMutationTools } from './http-mutation-mcp-tools.js';
import { registerBankStatementsBinaryOAuthUploadTools } from './binary-oauth-upload-mcp-tools.js';
import { registerMonthlyInvoiceMcpTools } from './monthly-invoice-mcp-tools.js';
import { registerAccountantPackMcpTools } from './accountant-pack-mcp-tools.js';
import { registerSurvivalPlanMcpTools } from './survival-plan-mcp-tools.js';

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
  availableFunds: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/available-funds`,
  entityLiquidityFx: `${BANK_STATEMENTS_AI_RESOURCE_BASE}/entity-liquidity-fx`,
} as const;

export type BankStatementsAiResourceUri =
  (typeof BankStatementsAiResourceUris)[keyof typeof BankStatementsAiResourceUris];

const MCPParameterizedToolForResourceKey: Partial<
  Record<keyof typeof BankStatementsAiResourceUris, string>
> = {
  liquidity: 'analytics_get_liquidity',
  pipeline: 'analytics_get_pipeline',
  runway: 'analytics_get_runway',
  snapshot: 'analytics_get_snapshot',
  'financial-snapshot': 'analytics_get_financial_snapshot',
  'financial-safety': 'analytics_get_financial_safety',
  spendByCurrency: 'analytics_get_spend_by_currency',
  availableFunds: 'analytics_get_available_funds',
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
    // Matches GET /api/ai/liquidity: `composeAiLiquidity` already ends with AiLiquidityResponseSchema.parse.
    const structuredContent = composeAiLiquidity(parsed.data);
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

/** @internal — same payload as `GET /api/income-composition`. */
export function runIncomeGetCompositionMcpTool(_args: unknown): McpJsonToolReturn {
  try {
    const structuredContent = IncomeCompositionResponseSchema.parse(composeAiIncomeComposition());
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  } catch (err) {
    return mcpAiInternalError(err instanceof Error ? err.message : 'Unknown error');
  }
}

/** @internal — composite decision read (financial safety + dashboard summary + optional balances). */
export function runHouseholdFinancialPostureMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = HouseholdFinancialPostureQuerySchema.safeParse(args ?? {});
  if (!parsed.success) return mcpAiInvalidParams(parsed.error.issues);
  try {
    const {
      includeBalancesByAccount,
      includeRunway,
      includeIncomeComposition,
      includeSpendRate,
      includeDeltas,
      spendRateWindow,
      ...snapshotQuery
    } = parsed.data;
    const {
      days: horizonDays,
      entityId: filterEntityId,
      detail: runwayDetail,
      account,
      financialYear,
      groupByEntity,
      commitmentDays,
    } = snapshotQuery;
    const loaded = loadForecastInputs({ horizonDays, filterEntityId });
    const financialSafety = composeAiFinancialSafety({
      horizonDays,
      commitmentDays,
      filterEntityId,
      runwayDetail,
      account,
      financialYear,
      groupByEntity,
      forecastInputs: loaded,
    });
    const summaryResult = readDashboardSummaryFromQuery({
      account,
      financialYear,
    });
    if (!summaryResult.ok) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: JSON.stringify(summaryResult.body, null, 2) }],
      };
    }

    let balancesByAccount: Record<string, AccountBalance> | undefined;
    if (includeBalancesByAccount === true) {
      balancesByAccount = {};
      for (const accountName of ACCOUNTS) {
        const bal = readDashboardBalance(accountName, { financialYear });
        if (!bal.ok) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify(bal.body, null, 2) }],
          };
        }
        balancesByAccount[accountName] = AccountBalanceSchema.parse(bal.body);
      }
    }

    let runway;
    if (includeRunway === true) {
      const assembled = assembleRunway({ forecastInputs: loaded });
      runway = runwayResponseFromAssembled(assembled, filterEntityId, {
        detail: runwayDetail ?? 'summary',
      });
    }

    const incomeComposition = includeIncomeComposition === true
      ? composeAiIncomeComposition()
      : undefined;

    const spendRate = includeSpendRate === true
      ? composeAiSpendRate({ window: spendRateWindow ?? 30, entityId: filterEntityId })
      : undefined;

    const deltas = includeDeltas === true
      ? composeHouseholdSpendDeltas(spendRateWindow ?? 30, filterEntityId, loaded.today)
      : undefined;

    const structuredContent = HouseholdFinancialPostureResponseSchema.parse({
      generatedAt: new Date().toISOString(),
      financialSafety,
      dashboardSummary: summaryResult.body,
      ...(balancesByAccount !== undefined ? { balancesByAccount } : {}),
      ...(runway !== undefined ? { runway } : {}),
      ...(incomeComposition !== undefined ? { incomeComposition } : {}),
      ...(spendRate !== undefined ? { spendRate } : {}),
      ...(deltas !== undefined ? { deltas } : {}),
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  } catch (err) {
    return mcpAiInternalError(err instanceof Error ? err.message : 'Unknown error');
  }
}

/** @internal */
export function runAnalyticsGetSpendRateMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = SpendRateQuerySchema.safeParse(args ?? {});
  if (!parsed.success) return mcpAiInvalidParams(parsed.error.issues);
  try {
    const structuredContent = AiSpendRateResponseSchema.parse(
      composeAiSpendRate({ window: parsed.data.window, entityId: parsed.data.entityId }),
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
export function runAnalyticsGetAvailableFundsMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = AvailableFundsQuerySchema.safeParse(args ?? {});
  if (!parsed.success) return mcpAiInvalidParams(parsed.error.issues);
  try {
    const structuredContent = AiAvailableFundsResponseSchema.parse(
      composeAiAvailableFunds({
        months: parsed.data.months,
        filterEntityId: parsed.data.entityId,
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
export function runAnalyticsGetUpcomingMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = UpcomingQuerySchema.safeParse(args ?? {});
  if (!parsed.success) return mcpAiInvalidParams(parsed.error.issues);
  try {
    const structuredContent = AiUpcomingResponseSchema.parse(
      composeAiUpcoming({
        months: parsed.data.months,
        kind: parsed.data.kind,
        filterEntityId: parsed.data.entityId,
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
export function runAnalyticsGetSurvivalMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = SurvivalQuerySchema.safeParse(args ?? {});
  if (!parsed.success) return mcpAiInvalidParams(parsed.error.issues);
  try {
    const structuredContent = AiSurvivalResponseSchema.parse(
      composeAiSurvival({
        scope: parsed.data.scope,
        dailyDiscretionary: parsed.data.dailyDiscretionary,
        targetDate: parsed.data.targetDate,
        horizonDays: parsed.data.horizonDays,
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
export function runSurvivalGetAllowanceMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = SpendAllowanceQuerySchema.safeParse(args ?? {});
  if (!parsed.success) return mcpAiInvalidParams(parsed.error.issues);
  try {
    const structuredContent = AiSpendAllowanceResponseSchema.parse(
      composeAiSpendAllowance({ period: parsed.data.period }),
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
    case BankStatementsAiResourceUris.availableFunds:
      return JSON.stringify(composeAiAvailableFunds());
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
        '## Outcome-first MCP (bank-statements-app)\n\n' +
        '**Tier-1 reads:** `household_financial_posture` (financial safety + dashboard summary + optional runway/income/spend-rate/deltas via `includeRunway`, `includeIncomeComposition`, `includeSpendRate`, `includeDeltas`) and `income_get_composition`. For money anxiety / survival: also **`analytics_get_survival`**, **`analytics_get_available_funds`**, **`survival_get_allowance`**.\n\n' +
        '**Survival & insights:** `analytics_get_available_funds` (future income, next/last payment date, projected available), `analytics_get_spend_rate` (daily/weekly/monthly burn split personal/business), `analytics_get_upcoming` (N-month expense/income buckets), `analytics_get_survival` (safe £/day + how long money lasts), `survival_get_allowance` (today\'s rollover budget), `survival_plan_commit` / `survival_plan_get` / `survival_plan_clear`.\n\n' +
        '**Canonical registry:** grouped prefixed tool ids live in `server/mcp/canonical-mcp-tool-registry.ts` (`CANONICAL_MCP_TOOL_GROUPS`) — use it as the Appendix A–style checklist for automation and reviews.\n\n' +
        '**Canonical naming:** tools use `{domain}_{action}` snake_case (`invoices_list`, `deadlines_create`, `financial_obligations_*`, …). The **first path segment** must be an approved domain token (see that registry). **`get_http_*` / `post_http_*` / `get_ai_*` / verb-first names remain as temporary aliases** registered alongside the canonical tool and will be removed after a deprecation window — always prefer the prefixed name in new automation.\n\n' +
        '**Analytics / §2.0:** `analytics_get_liquidity`, `analytics_get_pipeline`, `analytics_get_runway`, `analytics_get_snapshot`, `analytics_get_financial_snapshot`, `analytics_get_financial_safety`, `analytics_get_spend_by_currency` mirror `GET /api/ai/*` with the same Zod query shapes as legacy `get_ai_*` tools.\n\n' +
        '**Feeds & motion:** `bank_feed_sync` (alias `sync_bank_feed`); `transactions_drill_query` (alias `query_transactions`); OAuth starts: `feed_oauth_enable_start` / `feed_oauth_truelayer_start` (return `url`+`state` only — human browser completes redirects).\n\n' +
        '**Net worth:** `net_worth_capture_snapshot` (alias `capture_net_worth_snapshot`).\n\n' +
        '**Monthly invoices:** `invoices_preview_monthly` / `invoices_commit_monthly` (`previewFingerprint` on commit for drift QA — not a substitute for human approval).\n\n' +
        '**Accountant bundles (stubs):** `accountant_readiness_snapshot`, `accountant_preview_{vat,corporation_tax,sa}_bundle`, `accountant_send_{vat,corporation_tax,sa}_bundle` — manifests + outbound wiring TODO; legacy `accountant_pack_*` forwards to preview stubs.\n\n' +
        '**JSON GET parity:** `server/http/read/*` backs `*_list`, `dashboard_get_summary`, etc., with legacy `get_http_*` twins where applicable.\n\n' +
        '**Mutations:** prefixed `deadlines_*`, `financial_obligations_*`, `clients_update`, `warnings_resolve_inter_company_classifications`, `contracts_request_renewal` (validated **501** placeholder), `budgets_*`, `debts_*`, `debt_strategy_*`, `contracts_*` leave, invoices generate/reconcile — plus legacy `post_http_*` / `put_http_*` / `delete_http_*` aliases. Invoice reconcile **`dryRun` defaults true**; set `dryRun: false` to persist.\n\n' +
        '**Binary / base64:** `statements_upload_base64`, `invoices_upload_supplier_pdfs_base64`, `invoices_get_pdf_base64`, `contracts_get_signed_pdf_base64` embed PDFs as **`pdfBase64`** — decode to bytes and write `filename` locally for agents.\n\n' +
        '**Social contract:** confirm intent in chat before invoking `*_commit_*`, `*_send_*`, or destructive mutations — technical preview fingerprints (`previewFingerprint`) guard drift only, not approvals.\n\n' +
        '**Human approval & host allowlists:** Hermes Agent: `approvals.mode` (mostly **terminal** command gating — not MCP-wide) plus per-server MCP `tools.include` / `exclude` ([Security](https://hermes-agent.nousresearch.com/docs/user-guide/security), [Using MCP](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/guides/use-mcp-with-hermes.md)). **Cursor:** IDE MCP confirmation + per-tool allowlist; caveats ([hooks vs MCP](https://forum.cursor.com/t/hooks-return-allow-but-mcp-tool-still-requires-manual-approval-gets-skipped/155434), [`autoApprove` reliability](https://forum.cursor.com/t/atlassian-mcp-autoapprove-true-is-not-being-respected/139392)). Treat `*_commit_*`, `*_send_*`, and destructive tools as high blast-radius. **Outbound email (Resend)** should stay **owner-inbox-capped** in env until you widen recipients.\n\n' +
        '**UK Ltd VAT affordability:** `financial_obligations_list_upcoming` (filter type `vat`) or `financial_obligations_get_vat_reconciliation`; balances via `household_financial_posture` with `includeBalancesByAccount: true`. Ringfence pool for “cash to cover VAT” = **`barclays-current` + `barclays-savings`** (see `reserves/reserves.csv`). After paying upcoming VAT, remainder ≈ pool − obligation amount. Tax reserve warnings: `warnings_get_consolidated` codes `tax-reserve-*`.\n\n' +
        '**Not exposed:** cookie `site-login` sessions; OAuth callbacks. MCP auth here = **Bearer** on this listener.',
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

  const netWorthRegistration = {
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
  };

  server.registerTool('net_worth_capture_snapshot', netWorthRegistration, async args => {
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
  });

  server.registerTool(
    'capture_net_worth_snapshot',
    {
      ...netWorthRegistration,
      description:
        '**Deprecated.** Prefer `net_worth_capture_snapshot`. ' + netWorthRegistration.description,
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
        '§2.0 — GET /api/ai/liquidity parity (**deprecated tool name** — prefer `analytics_get_liquidity`). Optional account, financialYear, groupByEntity (boolean or "true"/"false").',
      inputSchema: LiquidityQuerySchema.shape,
      outputSchema: AiLiquidityResponseSchema.shape,
    },
    args => runGetAiLiquidityMcpTool(args),
  );

  server.registerTool(
    'analytics_get_liquidity',
    {
      description:
        '§2.0 — **Preferred** GET /api/ai/liquidity tool. Same inputs as `get_ai_liquidity` (deprecated alias).',
      inputSchema: LiquidityQuerySchema.shape,
      outputSchema: AiLiquidityResponseSchema.shape,
    },
    args => runGetAiLiquidityMcpTool(args),
  );

  server.registerTool(
    'get_ai_pipeline',
    {
      description:
        '§2.0 — GET /api/ai/pipeline parity (**deprecated** — prefer `analytics_get_pipeline`). days (default 720), optional entityId.',
      inputSchema: HorizonEntityQuerySchema.shape,
      outputSchema: AiPipelineResponseSchema.shape,
    },
    args => runGetAiPipelineMcpTool(args),
  );

  server.registerTool(
    'analytics_get_pipeline',
    {
      description: '§2.0 — **Preferred** GET /api/ai/pipeline. Same as `get_ai_pipeline` (deprecated).',
      inputSchema: HorizonEntityQuerySchema.shape,
      outputSchema: AiPipelineResponseSchema.shape,
    },
    args => runGetAiPipelineMcpTool(args),
  );

  server.registerTool(
    'get_ai_runway',
    {
      description:
        '§2.0 — GET /api/ai/runway parity (**deprecated** — prefer `analytics_get_runway`). days (default 720), optional entityId, detail accounts|summary (default summary).',
      inputSchema: RunwayQuerySchema.shape,
      outputSchema: RunwayResponseSchema.shape,
    },
    args => runGetAiRunwayMcpTool(args),
  );

  server.registerTool(
    'analytics_get_runway',
    {
      description:
        '§2.0 — **Preferred** GET /api/ai/runway. Same as `get_ai_runway` (deprecated).',
      inputSchema: RunwayQuerySchema.shape,
      outputSchema: RunwayResponseSchema.shape,
    },
    args => runGetAiRunwayMcpTool(args),
  );

  server.registerTool(
    'get_ai_snapshot',
    {
      description:
        '§2.0 — GET /api/ai/snapshot parity (**deprecated** — prefer `analytics_get_snapshot`). Merges runway + liquidity query params (days, entityId, detail, account, financialYear, groupByEntity).',
      inputSchema: SnapshotQuerySchema.shape,
      outputSchema: AiSnapshotResponseSchema.shape,
    },
    args => runGetAiSnapshotMcpTool(args),
  );

  server.registerTool(
    'analytics_get_snapshot',
    {
      description:
        '§2.0 — **Preferred** GET /api/ai/snapshot. Same as `get_ai_snapshot` (deprecated).',
      inputSchema: SnapshotQuerySchema.shape,
      outputSchema: AiSnapshotResponseSchema.shape,
    },
    args => runGetAiSnapshotMcpTool(args),
  );

  server.registerTool(
    'get_ai_financial_snapshot',
    {
      description:
        '§2.0 — GET /api/ai/financial-snapshot parity (**deprecated** — prefer `analytics_get_financial_snapshot`). Same as snapshot inputs plus commitmentDays (default 90).',
      inputSchema: FinancialSnapshotQuerySchema.shape,
      outputSchema: AiFinancialSnapshotResponseSchema.shape,
    },
    args => runGetAiFinancialSnapshotMcpTool(args),
  );

  server.registerTool(
    'analytics_get_financial_snapshot',
    {
      description:
        '§2.0 — **Preferred** GET /api/ai/financial-snapshot. Same as `get_ai_financial_snapshot` (deprecated).',
      inputSchema: FinancialSnapshotQuerySchema.shape,
      outputSchema: AiFinancialSnapshotResponseSchema.shape,
    },
    args => runGetAiFinancialSnapshotMcpTool(args),
  );

  server.registerTool(
    'get_ai_financial_safety',
    {
      description:
        '§2.0 — GET /api/ai/financial-safety parity (**deprecated** — prefer `analytics_get_financial_safety`). Same inputs as get_ai_financial_snapshot (FinancialSnapshot query).',
      inputSchema: FinancialSnapshotQuerySchema.shape,
      outputSchema: AiFinancialSafetyResponseSchema.shape,
    },
    args => runGetAiFinancialSafetyMcpTool(args),
  );

  server.registerTool(
    'analytics_get_financial_safety',
    {
      description:
        '§2.0 — **Preferred** GET /api/ai/financial-safety. Same as `get_ai_financial_safety` (deprecated).',
      inputSchema: FinancialSnapshotQuerySchema.shape,
      outputSchema: AiFinancialSafetyResponseSchema.shape,
    },
    args => runGetAiFinancialSafetyMcpTool(args),
  );

  server.registerTool(
    'get_ai_spend_by_currency',
    {
      description:
        '§2.0 — GET /api/ai/spend-by-currency parity (**deprecated** — prefer `analytics_get_spend_by_currency`). Exactly one of calendarMonth (YYYY-MM) or financialYear; optional entityId, account.',
      inputSchema: SpendByCurrencyQuerySchema.shape,
      outputSchema: AiSpendByCurrencyResponseSchema.shape,
    },
    args => runGetAiSpendByCurrencyMcpTool(args),
  );

  server.registerTool(
    'analytics_get_spend_by_currency',
    {
      description:
        '§2.0 — **Preferred** GET /api/ai/spend-by-currency. Same runner as deprecated `get_ai_spend_by_currency`.',
      inputSchema: SpendByCurrencyQuerySchema.shape,
      outputSchema: AiSpendByCurrencyResponseSchema.shape,
    },
    args => runGetAiSpendByCurrencyMcpTool(args),
  );

  server.registerTool(
    'income_get_composition',
    {
      description:
        '§1.7 household income composition (same payload as GET /api/income-composition and MCP resource `bankstatements://ai/income-composition`).',
      inputSchema: {},
      outputSchema: IncomeCompositionResponseSchema.shape,
    },
    raw => runIncomeGetCompositionMcpTool(raw ?? {}),
  );

  server.registerTool(
    'household_financial_posture',
    {
      description:
        'Composite decision snapshot: financial safety score + dashboard summary (includes availableFunds when scope=full). Optional `includeRunway`, `includeIncomeComposition`, `includeSpendRate`, `includeDeltas`, `includeBalancesByAccount`. **Use for holistic money health** before drilling into survival tools.',
      inputSchema: HouseholdFinancialPostureQuerySchema.shape,
      outputSchema: HouseholdFinancialPostureResponseSchema.shape,
    },
    raw => runHouseholdFinancialPostureMcpTool(raw ?? {}),
  );

  server.registerTool(
    'analytics_get_spend_rate',
    {
      description:
        'Spend rate per day/week/month split personal/business and mandatory/discretionary. **Use when the user asks how much they spend per day/week/month, burn rate, or personal vs business spending.**',
      inputSchema: SpendRateQuerySchema.shape,
      outputSchema: AiSpendRateResponseSchema.shape,
    },
    args => runAnalyticsGetSpendRateMcpTool(args),
  );

  server.registerTool(
    'analytics_get_available_funds',
    {
      description:
        'Cash now + after-tax future income, total funds, committed outflows, net after commitments; includes final contract payment date. **Use for future income, funds picture, or "what is coming in".**',
      inputSchema: AvailableFundsQuerySchema.shape,
      outputSchema: AiAvailableFundsResponseSchema.shape,
    },
    args => runAnalyticsGetAvailableFundsMcpTool(args),
  );

  server.registerTool(
    'analytics_get_upcoming',
    {
      description:
        'Expenses and income bucketed by month for the next N months. **Use when the user asks what is coming up, upcoming bills/income, or next few months cash flow.**',
      inputSchema: UpcomingQuerySchema.shape,
      outputSchema: AiUpcomingResponseSchema.shape,
    },
    args => runAnalyticsGetUpcomingMcpTool(args),
  );

  server.registerTool(
    'analytics_get_survival',
    {
      description:
        'Safe daily discretionary spend + how long money lasts after essentials and confirmed income. **Use when the user mentions losing a contract/job, money anxiety, survival mode, how long money will last, or how much they can safely spend per day.** Optional `dailyDiscretionary` or `targetDate` solve.',
      inputSchema: SurvivalQuerySchema.shape,
      outputSchema: AiSurvivalResponseSchema.shape,
    },
    args => runAnalyticsGetSurvivalMcpTool(args),
  );

  server.registerTool(
    'survival_get_allowance',
    {
      description:
        'Today\'s (or this week\'s) committed survival allowance with rollover — includes `tomorrowAllowanceGbp` after overspend. **Use for daily budget check: "how much can I spend today", "did I overspend", "tomorrow\'s budget".**',
      inputSchema: SpendAllowanceQuerySchema.shape,
      outputSchema: AiSpendAllowanceResponseSchema.shape,
    },
    args => runSurvivalGetAllowanceMcpTool(args),
  );

  registerSurvivalPlanMcpTools(server);

  // §3.4 — sync_bank_feed mirrors `POST /api/feed/sync`.
  // Same Zod input/output schemas; same `runFeedSync` engine. The MCP
  // surface differs only in the error envelope (we set `isError: true`
  // and embed a structured error body) — the route maps the same errors
  // to HTTP status codes.
  server.registerTool(
    'bank_feed_sync',
    {
      description:
        '§3.4 — **Preferred** name for AIS feed ingestion (`POST /api/feed/sync`). Same semantics as deprecated `sync_bank_feed`. dateFrom required; dateTo defaults to today; force overwrites originals.',
      inputSchema: FeedSyncBodySchema.shape,
      outputSchema: FeedSyncResponseSchema.shape,
    },
    args => runSyncBankFeedMcpTool(args),
  );

  server.registerTool(
    'sync_bank_feed',
    {
      description:
        '**Deprecated.** Prefer `bank_feed_sync`. §3.4 — AIS ingest for one configured account.',
      inputSchema: FeedSyncBodySchema.shape,
      outputSchema: FeedSyncResponseSchema.shape,
    },
    args => runSyncBankFeedMcpTool(args),
  );

  server.registerTool(
    'transactions_drill_query',
    {
      description:
        '**Preferred** — same composer as GET /api/ai/transactions-drill (runner shared with legacy `query_transactions`). **`account` optional**: omit to match all ledger accounts (no `AND account` in SQL). **Transfers**: with no `account`, default behaviour excludes `transfer` rows unless you set `type` (`income`/`expense`/`transfer`); `includeTransfers` only expands income/expense with transfers when **`account`** is a valid account id. **Prefer `account`** when the user names a specific bank/card. **Totals**: use `totalsByCurrency` / `aggregatesByAccount` — each has `currency`; do not add across mixed currencies without FX. **Merchant modal**: `merchantModalLabel` implies expense-type drill; cross-account drills do not get per-account transfer-as-expense expansion. Exactly one date window. Never both `search` and `merchantModalLabel`. `includeRows:false` returns aggregates only.',
      inputSchema: AiTransactionDrillQuerySchema.shape,
      outputSchema: AiTransactionDrillResponseSchema.shape,
    },
    async args => runQueryTransactionsMcpTool(args),
  );

  server.registerTool(
    'query_transactions',
    {
      description:
        '**Deprecated.** Prefer `transactions_drill_query`. Wave 03 — same composer as GET /api/ai/transactions-drill.',
      inputSchema: AiTransactionDrillQuerySchema.shape,
      outputSchema: AiTransactionDrillResponseSchema.shape,
    },
    async args => runQueryTransactionsMcpTool(args),
  );

  registerMonthlyInvoiceMcpTools(server);
  registerAccountantPackMcpTools(server);
  registerBankStatementsHttpJsonReadTools(server);
  registerBankStatementsHttpMutationTools(server);
  registerBankStatementsBinaryOAuthUploadTools(server);

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
