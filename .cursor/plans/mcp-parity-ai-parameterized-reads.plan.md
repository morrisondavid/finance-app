---
name: MCP — AI parameterized reads
overview: MCP tools for GET /api/ai/* with the same query params as HTTP (liquidity, pipeline, runway, snapshot, financial-snapshot, financial-safety, spend-by-currency). Replaces fixed-arg resource gap.
todos:
  - id: f1a2b3c4-d5e6-4789-f012-3456789abcde
    content: Register 7 tools in bank-mcp-server.ts; parse with same Zod as server/routes/ai.ts; update manifest + MCP instructions; contract tests; optional deprecate duplicate resources.
    status: completed
isProject: false
---

# AI parameterized `/api/ai/*` reads

## Depends on

- Nothing.

## Goals

MCP resources today call [`readBankStatementsAiResource`](../../server/mcp/bank-mcp-server.ts) with **fixed defaults**. HTTP [`server/routes/ai.ts`](../../server/routes/ai.ts) accepts **query params**. Add MCP **tools** (recommended names below) that `safeParse` the **same** schemas and call the **same** composers.

| Tool (indicative) | Zod | Composer / flow |
|-------------------|-----|-----------------|
| `get_ai_liquidity` | `LiquidityQuerySchema` | `composeAiLiquidity` |
| `get_ai_pipeline` | `HorizonEntityQuerySchema` | `composeAiPipeline` |
| `get_ai_runway` | `RunwayQuerySchema` | `assembleRunway` + `runwayResponseFromAssembled` |
| `get_ai_snapshot` | `SnapshotQuerySchema` | `composeAiSnapshot` |
| `get_ai_financial_snapshot` | `FinancialSnapshotQuerySchema` | `composeAiFinancialSnapshot` |
| `get_ai_financial_safety` | same as financial-snapshot query | `composeAiFinancialSafety` |
| `get_ai_spend_by_currency` | `SpendByCurrencyQuerySchema` | `composeAiSpendByCurrency` |

**Out of scope:** No-param resources (manifest, warnings, net-worth-history, etc.) can stay as resources.

## Files

- [`server/mcp/bank-mcp-server.ts`](../../server/mcp/bank-mcp-server.ts)
- [`server/domain/ai/manifest.ts`](../../server/domain/ai/manifest.ts)
- New/extended tests under [`server/mcp/`](../../server/mcp/)

## Build (Cursor)

1. Open this file in **Plan** view and click **Build** to implement **only this milestone**.
2. When done, set the todo above to **completed** and update the matching row in [mcp-parity-overview.plan.md](mcp-parity-overview.plan.md).

**Agent prompt (paste if not using Build):**

> Implement MCP AI parameterized reads as specified in `.cursor/plans/mcp-parity-ai-parameterized-reads.plan.md`: add parameterized AI read tools matching `server/routes/ai.ts`. Follow `.cursor/rules/engineering-standards.mdc`. Run `npx tsc --noEmit` and `npm run test:run`.
