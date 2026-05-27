---
name: MCP — External actions
overview: Email, accountant ZIP/packages, approvals — new integration epic (not REST parity). Leave booking stays on contracts HTTP/API (reads + mutations milestones).
todos:
  - id: f5e6f7a8-b9c0-4123-d456-789abcdef012
    content: Product spec + MCP tools for outbound email/packaging with provider keys, human approval, audit log, rate limits — separate from route mirroring.
    status: pending
isProject: false
---

# External actions (integrations)

## Depends on

- In-app MCP↔HTTP milestones first: through uploads/OAuth/binary ([mcp-parity-uploads-oauth-binary.plan.md](mcp-parity-uploads-oauth-binary.plan.md)) at minimum for a coherent baseline.

## Scope (new product)

- SMTP / transactional provider + secrets  
- Packaging rules (which artefacts, periods, redaction)  
- **Human approval** before send (recommended)  
- **Audit log**

This **does not** map 1:1 to existing REST; it **extends** what Hermes can do after parity.

## Build (Cursor)

1. **Plan** → **Build** when starting this **product/spec** slice (implementation may span multiple PRs).
2. Mark todo + overview when the **first vertical slice** (e.g. “email draft only”) ships, or split into finer plans later.

**Agent prompt:**

> Start MCP external actions per `.cursor/plans/mcp-parity-external-actions.plan.md`: produce spec + minimal approved slice for outbound/email or packaging (no substitutes for regulated advice).
