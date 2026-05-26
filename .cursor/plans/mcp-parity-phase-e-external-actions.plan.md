---
name: MCP Phase E — External actions
overview: Email, accountant ZIP/packages, approvals — new integration epic (not REST parity). Leave booking stays Phase B/C via contracts API.
todos:
  - id: f5e6f7a8-b9c0-4123-d456-789abcdef012
    content: Product spec + MCP tools for outbound email/packaging with provider keys, human approval, audit log, rate limits — separate from route mirroring.
    status: pending
isProject: false
---

# Phase E — External actions (integrations)

## Depends on

- **Phases A–D** for in-app API parity first.

## Scope (new product)

- SMTP / transactional provider + secrets  
- Packaging rules (which artefacts, periods, redaction)  
- **Human approval** before send (recommended)  
- **Audit log**

This **does not** map 1:1 to existing REST; it **extends** what Hermes can do after parity.

## Build (Cursor)

1. **Plan** → **Build** when starting this **product/spec** phase (implementation may span multiple PRs).
2. Mark todo + overview when the **first vertical slice** (e.g. “draft email draft only”) ships, or split into finer plans later.

**Agent prompt:**

> Start MCP Phase E per `.cursor/plans/mcp-parity-phase-e-external-actions.plan.md`: produce spec + minimal approved slice for outbound/email or packaging (no substitutes for regulated advice).
