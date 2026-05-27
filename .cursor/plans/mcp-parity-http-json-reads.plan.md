---
name: MCP — HTTP JSON read domains
overview: MCP tools mirroring HTTP GET for invoices, contracts (incl. GET leave), clients, company, obligations, deadlines, tax, warnings, statements, dashboard — same validation as routes.
todos:
  - id: f2b3c4d5-e6f7-4890-a123-456789abcdef
    content: Enumerate router.get in each target file; register one MCP tool per route (or small family); shared error envelope; contract tests incl. GET /api/contracts/:id/leave.
    status: completed
isProject: false
---

# HTTP JSON read / list parity

## Depends on

- **Recommended first:** AI parameterized `/api/ai/*` reads ([mcp-parity-ai-parameterized-reads.plan.md](mcp-parity-ai-parameterized-reads.plan.md)) so Hermes has filterable AI slices alongside route mirrors. Can overlap carefully.

## Routers

Walk **`router.get`** in each file and mirror with tools:

| Area | Router |
|------|--------|
| Invoices | [`server/routes/invoices.ts`](../../server/routes/invoices.ts) |
| Contracts + **GET leave** | [`server/routes/contracts.ts`](../../server/routes/contracts.ts) |
| Clients / company | [`server/routes/clients.ts`](../../server/routes/clients.ts), [`server/routes/company.ts`](../../server/routes/company.ts) |
| Obligations / deadlines | [`server/routes/obligations.ts`](../../server/routes/obligations.ts), [`server/routes/deadlines.ts`](../../server/routes/deadlines.ts) |
| Tax | [`server/routes/tax.ts`](../../server/routes/tax.ts) |
| Warnings | [`server/routes/warnings.ts`](../../server/routes/warnings.ts) — dedupe vs `/api/ai/warnings` if identical |
| Statements / dashboard | [`server/routes/statements.ts`](../../server/routes/statements.ts), [`server/routes/dashboard.ts`](../../server/routes/dashboard.ts) |
| Optional | [`forecast.ts`](../../server/routes/forecast.ts), [`runway.ts`](../../server/routes/runway.ts), [`public-holidays.ts`](../../server/routes/public-holidays.ts), [`version.ts`](../../server/routes/version.ts) |

**No POST/DELETE** here — mutations are [mcp-parity-mutations.plan.md](mcp-parity-mutations.plan.md).

## PDF / binary reads

If a GET returns a **stream** (e.g. invoice PDF), defer policy to [mcp-parity-uploads-oauth-binary.plan.md](mcp-parity-uploads-oauth-binary.plan.md) or return metadata + base64 per agreed pattern.

## Build (Cursor)

1. Open this file in **Plan** view and click **Build** for **only this milestone**.
2. Mark this plan’s todo and the matching row in [mcp-parity-overview.plan.md](mcp-parity-overview.plan.md) **completed** when done.

**Agent prompt:**

> Implement MCP HTTP JSON read parity per `.cursor/plans/mcp-parity-http-json-reads.plan.md`: read-only HTTP parity for listed routers. Reuse route Zod/domain. Follow engineering standards. Run `npx tsc --noEmit` and `npm run test:run`.
