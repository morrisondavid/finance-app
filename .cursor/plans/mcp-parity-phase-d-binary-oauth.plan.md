---
name: MCP Phase D — Uploads OAuth binary
overview: MCP policy + tools for multipart upload routes, Enable Banking / TrueLayer OAuth ergonomics, PDF/binary responses — completes hard HTTP parity cases.
todos:
  - id: f4d5e6f7-a8b9-4012-c345-6789abcdef01
    content: Document transport policy (base64 vs staged path vs human); implement upload mirror(s); OAuth tools returning auth URLs or human-defer; invoice PDF/binary alignment; tests where feasible.
    status: pending
isProject: false
---

# Phase D — Uploads + OAuth + PDF/binary

## Depends on

- **Phases A–C** for JSON-first parity.

## Upload

[`server/routes/upload.ts`](../../server/routes/upload.ts) — pick one strategy:

1. Base64 in tool input + strict size limits  
2. Server-local staged path (trusted operator)  
3. Pre-signed / separate HTTP shim  

Document chosen policy in MCP [`instructions`](../../server/mcp/bank-mcp-server.ts).

## OAuth

[`server/routes/enable-oauth.ts`](../../server/routes/enable-oauth.ts), [`server/routes/truelayer-oauth.ts`](../../server/routes/truelayer-oauth.ts) — MCP cannot finish browser redirects: expose **authorization URL + state**, or **human-required** flows + polling/status tools.

## PDF / binary

Align invoice PDF [`server/routes/invoices.ts`](../../server/routes/invoices.ts) with same binary policy.

## Site auth

[`site-auth`](../../server/routes/site-auth.ts) may remain **human-only**; MCP keeps **Bearer** on MCP listener.

## Build (Cursor)

1. **Plan** → **Build** for **Phase D only**.
2. Update [mcp-parity-overview.plan.md](mcp-parity-overview.plan.md).

**Agent prompt:**

> Implement MCP Phase D per `.cursor/plans/mcp-parity-phase-d-binary-oauth.plan.md`. Follow engineering standards. Run `npx tsc --noEmit` and `npm run test:run`.
