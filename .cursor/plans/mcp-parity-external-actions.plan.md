---
name: MCP — External actions
overview: Single epic doc — transactional email + accountant packages + MCP outcome tools + UI parity. Slice 1 = monthly invoice workflow (occupancy/gaps, preview/commit, outbox); later slices = VAT/CT/SA bundles, broader approval/audit MCP.
todos:
  - id: f5e6f7a8-b9c0-4123-d456-789abcdef012
    content: Epic umbrella — transactional email + packaging + human approval + audit (slice 1 = monthly invoice detailed below)
    status: completed
  - id: ea-slice1-overlap
    content: Slice 1 — period overlap helper + refactor supplier-month-gaps + existingInvoicesOccupyingContractBillingMonth
    status: completed
  - id: ea-slice1-generate-guards
    content: Slice 1 — preconditions before createInvoice (monthly supplier-issued, occupancy incl. drafts, gap-list strict + optional escape)
    status: completed
  - id: ea-slice1-preview-checks
    content: Slice 1 — draft days_billed vs calculateWorkload in preview workflow
    status: completed
  - id: ea-slice1-workflow-surfaces
    content: Slice 1 — monthly-invoice-workflow + MCP preview_monthly_invoice / commit_monthly_invoice + HTTP /api/invoices/monthly/* + public invoices UI; client_name resolution
    status: completed
  - id: ea-slice1-outbox
    content: Slice 1 — DeliveryAdapter + outbox idempotency + hardcoded To in one module early on
    status: completed
  - id: ea-slice1-tests
    content: Slice 1 — unit + MCP + route tests + tsc + test:run
    status: completed
  - id: ea-slice2-accountant-mcp
    content: Slice 2 — accountant packages (VAT/CT/SA) outcome MCP tools + manifest validation + shared delivery outbox patterns from slice 1
    status: completed
isProject: false
---

# External actions — integrations epic (single plan)

Email, accountant ZIP/packaging, human approval, audit log, **and** MCP tools that expose **business outcomes** (not only `post_http_*` parity). Depends on MCP↔HTTP through uploads/OAuth/binary ([mcp-parity-uploads-oauth-binary.plan.md](mcp-parity-uploads-oauth-binary.plan.md)).

**Historical note:** A detailed invoice draft lived in [`monthly-supplier-invoice-outcome-mcp.plan.md`](monthly-supplier-invoice-outcome-mcp.plan.md); that file is now a **redirect** only. Edit **this** document.

---

## Product slices (ordering)

| Slice | What | MCP / UI gist |
|-------|------|----------------|
| **1** | Monthly consultant invoice issuance + outbound email hook | **`preview_monthly_invoice`**, **`commit_monthly_invoice`**; mirrored HTTP for [`public/src/modules/invoices.ts`](../../public/src/modules/invoices.ts); shared workflow module in domain |
| **2** | Accountant document bundles — VAT returns support pack, corp tax pack, SA/self-assessment pack | Outcome-shaped tools along the lines of **`accountant_send_vat_documents`**, **`accountant_send_corp_tax_documents`**, **`accountant_send_sa_tax_documents`** — each validates **manifest** (missing bank statements → structured error); **reuse** DeliveryAdapter + outbox + preview/approve semantics from slice 1 |
| **3+** | Broader approvals UX, immutable audit CSV/log, rate limits, dynamic recipient registry | Layers on slices 1–2 |

Slices **2–3 are specified at epic level here** until you break them into build tasks during implementation PRs.

---

## Architecture: server = brain; UI + MCP = two faces

| Layer | Role |
|-------|------|
| **Brain** | **`server/domain/*`**, **`server/http/read/*`**, **`server/http/mutation/*`** |
| **UI** | **`public/`** → **`/api/...`** for behaviour |
| **MCP** | **`server/mcp/*`** wraps same reads/mutations or thin **workflow** modules |

**Existing gap:** [`public/src/modules/invoices.ts`](../../public/src/modules/invoices.ts) duplicates overlap logic (**`periodsOverlap`**) and only warns for **non-draft** invoices; slice 1 **removes that drift** via server **`preview`** payloads (`occupancy` / flags).

---

## Slice 1 — Goals (monthly invoice)

- **Occupancy:** no second **`createInvoice`** when **any** row (draft **or** issued) for **`contract_id`** **occupies** the billing calendar month — same overlap geometry as **`listSupplierMonthlyInvoiceGaps`** ([`supplier-month-gaps.ts`](../../server/domain/invoices/supplier-month-gaps.ts)).
- **Gap list:** default **commit** requires **`(contract_id, month)`** in **`listSupplierMonthlyInvoiceGaps`** unless **`allowOutsideGapList`** escape; gaps = **completed past months** before current month (“bill prior month on 1st”).
- **Inputs:** **`client_name`** (match **`legal_name` / `trading_name`**), optional **`billing_month`** (**`YYYY-MM`**; default **previous complete calendar month** policy); **`contract_id`** when disambiguating multiple monthly supplier-issued contracts for one client.
- **Naming:** **`workflow`** in new modules; no **`assert*`** in production names; **`supplier-issued`** only where it mirrors [`invoice_mechanism`](../../shared/api-contracts.ts) in code.

---

## Slice 1 — Helpers and guards

1. **`server/domain/invoices/period-range-overlap.ts`** — **`isoPeriodRangesOverlap`**; refactor [`supplier-month-gaps.ts`](../../server/domain/invoices/supplier-month-gaps.ts).
2. **`existingInvoicesOccupyingContractBillingMonth(contractId, billingMonth, invoices)`** — callers pass **`YYYY-MM`** only.
3. **`mutateInvoiceGenerate`** ([`server/http/mutation/invoices.ts`](../../server/http/mutation/invoices.ts)) — guards before **`createInvoice`**.

---

## Slice 1 — Preview workflow

- **`days_billed`** vs **`calculateWorkload`** (same spirit as [`deriveInvoiceDaysMismatchWarnings`](../../server/domain/warnings/invoice-days-mismatch.ts)).
- Compose from **`buildDraftInvoice`** / [`readInvoiceDraftFromQuery`](../../server/http/read/invoices.ts).

---

## Slice 1 — Workflow module + surfaces

- e.g. **`server/domain/invoices/monthly-invoice-workflow.ts`**: **`preview…`**, **`commit…`** (**`previewFingerprint`** on commit); call **`mutateInvoiceGenerate`** after checks.
- **MCP:** [`server/mcp/monthly-invoice-mcp-tools.ts`](../../server/mcp/) (**`preview_monthly_invoice`**, **`commit_monthly_invoice`**) — update [`bank-mcp-server.ts`](../../server/mcp/bank-mcp-server.ts).
- **HTTP:** **`POST /api/invoices/monthly/preview`**, **`POST /api/invoices/monthly/commit`** (thin, same workflow exports).
- **Outbound:** **`DeliveryAdapter`**, **`To`** single module early rollout, **outbox** idempotency.

---

## Slice 2 — Accountant packages (MCP outcome tools, epic-level)

Deliver when slice 1 outbox/send path exists:

- **Tools (names indicative):** e.g. **`accountant_pack_vat`**, **`accountant_pack_corp_tax`**, **`accountant_pack_sa`** — MCP describes **intent + period**, not filesystem paths or raw email headers; server resolves files, validates **coverage** (e.g. missing statements → **`missing_documents`** codes), **`preview`** / **`confirm`** analogue to invoicing where appropriate.
- **Parity:** same workflow engine callable from UI buttons + MCP.
- Detail **manifest per pack** during implementation (which CSVs/PDFs, which entities).

---

## MCP ergonomics backlog (cross-slice)

| Area | Issue | Direction |
|------|-------|-----------|
| Monthly invoice | `get_http_invoice_draft` + `post_http_invoice_generate` requires full **`Invoice`** | Prefer slice 1 outcome tools |
| Invoice PDF MCP | **`get_http_invoice_pdf_base64`** requires **`invoiceId`** | Embed ids/summary after **`commit`** where useful |
| Leave | Separate book vs preview | Optional **`book_leave_with_notice`** workflow later |

Keep **`post_http_*` / `get_http_*`** for parity regression.

---

## Tests (slice 1)

Overlap, occupancy, gaps, stale fingerprint; MCP + route contracts; **`npx tsc --noEmit`**, **`npm run test:run`**.

---

## Build order

1. Overlap + occupancy + gap refactor  
2. **`mutateInvoiceGenerate`** guards  
3. Workflow preview/commit + client resolution  
4. Outbox + adapter  
5. MCP + HTTP + UI; delete browser duplicate overlap  
6. **Then** slice 2 accountant packs on top  

---

## Agent prompt

> Implement `.cursor/plans/mcp-parity-external-actions.plan.md` slice 1 (extend with slice 2 when ready): monthly invoice MCP + HTTP + UI, outbound hooks; accountant packages — outcome MCP tools and manifests as slice 2. Engineering standards; **`npx tsc --noEmit`** and **`npm run test:run`**.
