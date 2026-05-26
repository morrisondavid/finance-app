---
name: MCP Phase C — Mutations
overview: MCP tools for POST/PUT/PATCH/DELETE — contracts (leave book/delete, leave-preview), invoices (generate, reconcile w/ dryRun policy), debts, debt-strategy, budgets, expenses.
todos:
  - id: f3c4d5e6-f7a8-4901-b234-56789abcdef0
    content: Mirror mutating routes with same bodies; invoice reconcile default dryRun=true for MCP unless explicit confirm; document side effects in tool descriptions; tests.
    status: pending
isProject: false
---

# Phase C — Mutation parity

## Depends on

- **Phase B** recommended so reads exist first.

## Scope

| Area | Router | Examples |
|------|--------|----------|
| Contracts + leave | [`server/routes/contracts.ts`](../../server/routes/contracts.ts) | `POST /:id/leave`, `DELETE /:id/leave/:leaveId`, `POST /:id/leave-preview` |
| Invoices | [`server/routes/invoices.ts`](../../server/routes/invoices.ts) | `POST /generate`, `POST /reconcile` |
| Debts | [`server/routes/debts.ts`](../../server/routes/debts.ts) |
| Debt strategy | [`server/routes/debt-strategy.ts`](../../server/routes/debt-strategy.ts) |
| Budgets | [`server/routes/budgets.ts`](../../server/routes/budgets.ts) |
| Expenses | [`server/routes/expenses.ts`](../../server/routes/expenses.ts) |

Enumerate **`router.post` / `put` / `patch` / `delete`** per file; extend list if other routers need parity.

## Safety

- **Invoice reconcile:** prefer **`dryRun: true` default** in MCP unless you add **`confirm`**.
- Tool descriptions must state **persisted side effects**.

## Build (Cursor)

1. **Plan** view → **Build** for **Phase C only**.
2. Mark todos here and in [mcp-parity-overview.plan.md](mcp-parity-overview.plan.md).

**Agent prompt:**

> Implement MCP Phase C per `.cursor/plans/mcp-parity-phase-c-mutations.plan.md`. Follow engineering standards. Run `npx tsc --noEmit` and `npm run test:run`.
