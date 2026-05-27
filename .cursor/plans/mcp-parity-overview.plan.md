---
name: MCP HTTP parity roadmap
overview: Index for MCP↔HTTP parity split by milestone (Hermes-friendly). Each linked plan focuses one slice; names describe work, not internal codenames — avoid leaking “phase X” labels into application code or identifiers.
todos:
  - id: a1b2c3d4-e5f6-4789-a012-3456789abcde
    content: "AI parameterized `/api/ai/*` reads → open mcp-parity-ai-parameterized-reads.plan.md"
    status: completed
  - id: b2c3d4e5-f6a7-4890-b123-456789abcdef
    content: "HTTP JSON read domains (`get_http_*`) → open mcp-parity-http-json-reads.plan.md"
    status: completed
  - id: c3d4e5f6-a7b8-4901-c234-56789abcdef0
    content: "Mutation parity → open mcp-parity-mutations.plan.md"
    status: pending
  - id: d4e5f6a7-b8c9-4012-d345-6789abcdef01
    content: "Uploads + OAuth + binary → open mcp-parity-uploads-oauth-binary.plan.md"
    status: completed
  - id: e5f6a7b8-c9d0-4123-e456-789abcdef012
    content: "External actions (non-REST integrations) → open mcp-parity-external-actions.plan.md"
    status: pending
isProject: true
---

# MCP near–HTTP parity (roadmap)

Each milestone has its **own** `.plan.md` — in Cursor Plan view that gives you a **Build** button **per milestone** when you are ready.

## Milestone plans

| Milestone | File |
|-----------|------|
| AI parameterized `/api/ai/*` reads | [mcp-parity-ai-parameterized-reads.plan.md](mcp-parity-ai-parameterized-reads.plan.md) |
| HTTP JSON read domains (`get_http_*`) | [mcp-parity-http-json-reads.plan.md](mcp-parity-http-json-reads.plan.md) |
| Mutations (POST/PUT/PATCH/DELETE parity) | [mcp-parity-mutations.plan.md](mcp-parity-mutations.plan.md) |
| Uploads, OAuth, PDF/binary | [mcp-parity-uploads-oauth-binary.plan.md](mcp-parity-uploads-oauth-binary.plan.md) |
| Email / accountant packages / outbound (new product surface) | [mcp-parity-external-actions.plan.md](mcp-parity-external-actions.plan.md) |

After each Build finishes, mark that milestone’s todo above **completed** (and matching todo inside the plan file).

## Cumulative parity (order of magnitude)

| After this milestone | Parity |
|----------------------|--------|
| AI parameterized reads | `/api/ai/*` slices match HTTP query semantics via `get_ai_*`; other API unchanged |
| HTTP JSON reads | Large share of **GET** JSON routes for listed domains |
| Mutations | Most **writes** for those domains + enumerated extras (debts / budgets / expenses / debt-strategy, …) |
| Uploads / OAuth / binary | Upload story + bank OAuth + binary/PDF alignment — **~90–95%+** of mounted business routes (excluding cookie-only UI flows) |
| External actions | **Not** REST parity — new outbound product capabilities |

## Shared principles

- **One HTTP route ↔ one MCP tool** (or small named family); reuse **same Zod + domain** as [`server/routes/*.ts`](../../server/routes/).
- **Envelope:** `structuredContent` on success; `isError` + issues on bad input (see `query_transactions` / `sync_bank_feed`).
- **Hermes:** registers [`server/mcp/bank-mcp-server.ts`](../../server/mcp/bank-mcp-server.ts) via MCP config — expanding tools there is what agents see.
- **Naming:** Prefer domain terms in source (`HttpJsonReadMcpToolResult`, `registerBankStatementsHttpJsonReadTools`, …), not roadmap labels.

## Legacy note

An older single-file plan may still exist at `~/.cursor/plans/mcp_full_parity_321d666e.plan.md` — **this folder is the source of truth** for the split roadmap.
