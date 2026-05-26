---
name: MCP HTTP parity roadmap
overview: Index for phased MCP↔HTTP parity (Hermes-friendly domain tools). Open each linked phase plan and use Cursor **Build** when ready to implement that phase only.
todos:
  - id: a1b2c3d4-e5f6-4789-a012-3456789abcde
    content: "Phase A — AI parameterized reads → open mcp-parity-phase-a-ai-params.plan.md"
    status: pending
  - id: b2c3d4e5-f6a7-4890-b123-456789abcdef
    content: "Phase B — Read domains → open mcp-parity-phase-b-read-domains.plan.md"
    status: pending
  - id: c3d4e5f6-a7b8-4901-c234-56789abcdef0
    content: "Phase C — Mutations → open mcp-parity-phase-c-mutations.plan.md"
    status: pending
  - id: d4e5f6a7-b8c9-4012-d345-6789abcdef01
    content: "Phase D — Uploads + OAuth + binary → open mcp-parity-phase-d-binary-oauth.plan.md"
    status: pending
  - id: e5f6a7b8-c9d0-4123-e456-789abcdef012
    content: "Phase E — External actions (non-REST) → open mcp-parity-phase-e-external-actions.plan.md"
    status: pending
isProject: true
---

# MCP near–HTTP parity (roadmap)

Work is split so each phase has its **own** `.plan.md` file — in Cursor Plan view, that gives you a **Build** button **per phase** when you are ready to implement it.

## Phase plans (open in editor → Plan → Build)

| Phase | File |
|-------|------|
| A — Parameterized `/api/ai/*` reads | [mcp-parity-phase-a-ai-params.plan.md](mcp-parity-phase-a-ai-params.plan.md) |
| B — Read / list domains | [mcp-parity-phase-b-read-domains.plan.md](mcp-parity-phase-b-read-domains.plan.md) |
| C — Mutations | [mcp-parity-phase-c-mutations.plan.md](mcp-parity-phase-c-mutations.plan.md) |
| D — Uploads, OAuth, PDF/binary | [mcp-parity-phase-d-binary-oauth.plan.md](mcp-parity-phase-d-binary-oauth.plan.md) |
| E — Email / accountant packages (new product) | [mcp-parity-phase-e-external-actions.plan.md](mcp-parity-phase-e-external-actions.plan.md) |

After each Build finishes, mark that phase’s todo above **completed** (and the matching todo inside the phase file).

## Cumulative feature parity (order of magnitude)

| Done through | Parity |
|--------------|--------|
| **A** | Parameterized §2.0 AI GETs match HTTP; rest of API unchanged |
| **B** | Large share of **GET** routes for listed domains |
| **C** | Most **mutations** for those domains + debts / budgets / expenses / debt-strategy (if enumerated) |
| **D** | Upload + bank OAuth + binary story — **~90–95%+** of mounted business routes (excl. cookie UI auth) |
| **E** | **Not** REST parity — new outbound capabilities |

## Shared principles

- **One HTTP route ↔ one MCP tool** (or small named family); reuse **same Zod + domain** as [`server/routes/*.ts`](../../server/routes/).
- **Envelope:** `structuredContent` on success; `isError` + issues on bad input (see `query_transactions` / `sync_bank_feed`).
- **Hermes:** registers your [`server/mcp/bank-mcp-server.ts`](../../server/mcp/bank-mcp-server.ts) via MCP config — expanding tools here is what agents see.

## Legacy note

An older single-file plan may still exist at `~/.cursor/plans/mcp_full_parity_321d666e.plan.md` — **this folder is the source of truth** for the split roadmap.
