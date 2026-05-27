---
name: MCP outcome-focused gap closure
overview: "Outcome-first MCP: **prefixed domain tool names**, decision snapshots, parity aliases during migration, accountant **`readiness` / `preview` / `send`** surfaced (preview/fingerprint as **QA convenience**, not mandatory human-approval infra). Operational safety baseline: **`RESEND`/app config delivers only to the owner inbox** until you widen recipients. MCP client (Cursor) already prompts before many tool runs — see § Light-touch safety."
todos:
  - id: inventory-outcome-catalog
    content: Cross-check Appendix A canonical names vs routers; reconcile planned vs shipped; mark legacy alias sunset dates.
    status: completed
  - id: decision-snapshot-tools
    content: "**Priority read** — `income_get_composition` (tool parity with GET /api/income-composition) + composite **`household_financial_posture`** (financial safety same envelope as **`analytics_get_financial_safety`** target, dashboard summary slice, optional per-account balances)—orchestration only."
    status: completed
  - id: prefixed-registry-migration
    content: "Implement **canonical prefixed tool registry**: register dual names (`invoices_list` + legacy `get_http_invoices`) with deprecation sunset in MCP instructions/tests, then drop legacy identifiers in a follow-on release."
    status: completed
  - id: naming-aliases-docs
    content: MCP instructions document **mandatory `{domain}_…` snake_case naming** (leading token = Appendix A vocabulary), lineage `get_ai_*` paired with `analytics_*`, and tiers (`household_financial_posture` first).
    status: completed
  - id: accountant-tool-names
    content: "Accountant slice: **`accountant_readiness_snapshot`** (read-only gaps); **`accountant_preview_{vat,corporation_tax,sa}_bundle`** (optional **`previewFingerprint`**); **`accountant_send_{vat,corporation_tax,sa}_bundle`** — persist/outbound (**no `commit_` in name**: **send** already denotes finalization). Replace `accountant_pack_*`. **Outbound:** owner-inbox cap in adapter/env."
    status: completed
  - id: mutation-human-approval-pattern
    content: "Docs only — Hermes Agent: **[Security](https://hermes-agent.nousresearch.com/docs/user-guide/security)** (`approvals.mode` for terminal commands) + **[MCP tool allowlisting](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/guides/use-mcp-with-hermes.md)** (`tools.include`/`exclude`). Cursor: MCP run confirmation + forum caveats (#155434/#139392). **Defer** server nonces unless ops widen beyond owner inbox."
    status: completed
  - id: principles-instructions
    content: "Expand MCP instructions using **Appendix A** registry: tiers, deprecation of legacy aliases, optional JSON base64 blobs."
    status: completed
  - id: outcome-reads-snapshots
    content: "Snapshots: `fixed_expenses_*`, `debt_strategy_get_state`, etc.; only add thin legacy `get_http_*` aliases during migration—not as steady-state surface."
    status: completed
  - id: outcome-writes-deadlines-obligations
    content: Deadlines/obligations with **prefixed IDs** (`deadlines_*`, `financial_obligations_*`) per naming appendix.
    status: completed
  - id: outcome-writes-clients-warnings-contracts
    content: "`clients_*`, **`warnings_resolve_inter_company_classifications`** (or defer if low value), `contracts_request_renewal` exposing today’s validated JSON renewal body (scan-from-PDF/OCR stays a separate future pipeline)."
    status: completed
  - id: binary-and-ingest
    content: "`contracts_get_signed_pdf_base64` / statement export tools: document decode-to-disk for agents."
    status: completed
  - id: tests-contracts
    content: Contract tests + route tests authoritative; OAuth/auth boundaries.
    status: completed
isProject: true
---

# Outcome-focused MCP — close the gaps for AI consumers

## Positioning

**Goal:** The AI assistant gets **few, decision-grade tools** first; raw mirrors exist for completeness, not as the mental model.

**Dual layer:**


| Layer                                                                                                                                      | What it is                                                                                                                | When to use                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Outcome / domain tools** (`household_financial_posture`, `income_get_composition`, `invoices_preview_monthly`, `deadlines_mark_done`, …) | MCP tools use **`domain_action`** (`snake_case`): leading token = owning domain (`invoices`, `deadlines`, `dashboard`, …) | **Primary**                                                  |
| **Legacy HTTP-shaped aliases** (`get_http_dashboard_summary`, `post_http_budgets`, …)                                                      | Older identifiers; mirror REST **names only** — still MCP tools                                                           | **Deprecation path** → register prefixed twin, remove legacy |


**Mandatory naming rule:** every MCP tool name starts with an **approved domain prefix** (see appendix registry). Exceptions: zero during steady state — during migration only, legacy aliases may coexist.

REST stays at `/api/...`; MCP uses **prefixed tool names** only.

The monthly invoice pattern remains the reference for **guarded writes**: **`invoices_preview_monthly`** / **`invoices_commit_monthly`** (fingerprint on commit).

---

## Light-touch safety (your chosen baseline — no heavyweight approval infra)

### In-repo / app config

1. **`commit_monthly_invoice`** and **`accountant_send_*`** paths ultimately use **existing outbound adapters** (`RESEND`, etc.). Hard-cap **delivery to your mailbox only** (or disable external send except to a test inbox) → **bounded blast radius** if an agent invokes a send tool prematurely.
2. Keep **instructions** (“always describe intent and wait for explicit user confirmation in chat **before** calling any `*_commit_*`, `*_send_*`, destructive tool”) — social contract only, but cheap.
3. **Invoice workflow** retains **`previewFingerprint`** as **technical guardrail against silent payload drift**, not as a substitute for human approval infra.

### Hermes Agent (Nous Research) vs this repo’s “Hermes-friendly” wording

Your question refers to **[Hermes Agent](https://github.com/NousResearch/hermes-agent)** (self-hosted assistant by Nous Research; docs e.g. [Security](https://hermes-agent.nousresearch.com/docs/user-guide/security), [Using MCP](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/guides/use-mcp-with-hermes.md), [MCP config reference](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/mcp-config-reference.md)). That is **not** the same as occasional **inline comments** in *this repo* (“Hermes-style drill”) meaning “good for MCP consumers” — see [.cursor/plans/mcp-parity-overview.plan.md](.cursor/plans/mcp-parity-overview.plan.md).

**Does Hermes have a mode that limits what runs without approval?**

- **`approvals.mode`** in `~/.hermes/config.yaml`: **`manual`** (default — prompt on risky **shell/terminal** patterns), **`smart`** (helper LLM triage), **`off`** or **`/yolo`** (no prompts). Sources: official [Security · Dangerous command approval](https://hermes-agent.nousresearch.com/docs/user-guide/security). This is centred on **command execution**, **not** a documented “approve every MCP tool call” umbrella.
- **MCP narrowing:** Hermes exposes **per-server** `tools.include` / `tools.exclude` (allowlist/blocklist native MCP tools) and `tools.resources` / `tools.prompts` toggles for wrapper utilities — the primary way to restrict what the model can invoke over MCP ([use-mcp-with-hermes](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/guides/use-mcp-with-hermes.md)).
- **No single knob** surfaced in docs as “Hermes Mode: block all mutations until human approves **each MCP tool invoke**”; combine **`tools.include`** (minimal set), **`manual` approvals**, **`/yolo` off**, plus app-side caps (your owner-only outbound).

### Cursor (IDE MCP host) — separate from Hermes Agent

Independent of bank-statements-app:

- Cursor typically shows a **confirmation step before running MCP tools** (e.g. “Run MCP Tool” — user can Run / Skip / add to **allowlist**). Exact behaviour varies by Cursor version and **Agents / Auto-Run** settings.
- Community reports ([Cursor forum — hooks vs MCP approval](https://forum.cursor.com/t/hooks-return-allow-but-mcp-tool-still-requires-manual-approval-gets-skipped/155434)): **hooks that return ALLOW do not override** the MCP confirmation path — they operate on separate layers; hooks are strongest for **deny**.
- Community reports ([Cursor forum — Atlassian MCP `autoApprove`](https://forum.cursor.com/t/atlassian-mcp-autoapprove-true-is-not-being-respected/139392)): **`autoApprove` in `mcp.json` not documented/reliable as a bypass** — use Cursor’s **MCP confirmation / allowlisting UI** rather than undocumented flags.
- **Practical tightening:** avoid allowlisting destructive tools; approve each run manually; reserve “run everything”-style automation for disposable environments only.

### What we are **not** planning (unless you revisit)

Dedicated **approval nonce / session token** gates on every mutation — deferred. Reintroduce only if outbound can target third parties beyond your sandbox inbox.

---

## Accountant bundles (`readiness` / `preview` / `send`)

“**Assemble**” implied blind collation. Revised tool families:


| Intent                                          | Canonical tools (VAT / corp tax / SA paralleling)                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Early warning (“1–2 weeks before deadline”)** | `**accountant_readiness_snapshot`** — inputs e.g. `regime`, `period_label`, `deadline_horizon_days` → structured `**present**`, `**missing**`, `**recommended_next_steps**` (**no ZIP, no email, no ledger writes** beyond optional cached read models if any). Comparable to invoicing preview in spirit — **truth report only**.                |
| **Package review before outbound**              | `**accountant_preview_vat_bundle`**, `**accountant_preview_corporation_tax_bundle**`, `**accountant_preview_sa_bundle**` — manifests + optional `zipBase64`; optional `**previewFingerprint**` (drift QA); **no** outbound send yet.                                                                                                              |
| **Send package**                                | **`accountant_send_vat_bundle`**, **`accountant_send_corporation_tax_bundle`**, **`accountant_send_sa_bundle`** — persist/outbound; blast radius capped by owner-only routing when Resend is pinned; optional **`previewFingerprint`** on send for drift QA only (**no `commit_` in tool name**: **send** implies finalization). |


**Naming:** **`accountant_preview_*`** → **`accountant_send_*`**. **`commit_`** stays only where the domain already uses it (e.g. **`invoices_commit_monthly`**). **`assemble_*`** retired.

### `get_ai_liquidity`, `get_ai_runway`, etc. — why `_ai_`?

**Historical meaning:** `_ai_` denotes tools that mirror the **§2.0 JSON routes under `GET /api/ai/...`** (shared composers in `[server/domain/ai/](server/domain/ai/)`, contracts in `[shared/api-contracts.ts](shared/api-contracts.ts)` under `Ai*ResponseSchema`). It is **not** “this endpoint uses an LLM” — it is “this endpoint belongs to the **analytics / assisted-insight HTTP surface** the app uses for parameterized reads.”

**Plan:** Register paired aliases: legacy `**get_ai_*`** + canonical `**analytics_***` (appendix registry below); remove `get_ai_*` after deprecation window. Steer `**household_financial_posture**` before granular analytics unless slicing.

---

### HTTP verb tools (`get_http_*`, `post_http_*`, …) — outcome-oriented?

**No — by design.** They are the **parity / escape hatch** layer: thin wrappers calling `[server/http/read/](server/http/read/)*` and `[server/http/mutation/*](server/http/mutation/)`.

**Plan:**

- Register **canonical `domain_*`** tools first; `**get_http_*` / `post_http_***` exist only as **temporary aliases** during migration (`prefixed-registry-migration`).
- Net-new parity must **never** mint fresh `http_`-styled names — only prefixed (`invoices_*`, `budgets_*`, …).

Planned endpoints that do not yet exist MUST launch under `**deadlines_*`**, `**financial_obligations_***`, `**fixed_expenses_***`, `**debts_***`, etc.

---

### `get_budget_workspace` → renamed

“Workspace” was overloaded. Prefer:

- `**budgets_get_category_names**` + `**budgets_list_lines**` (account-scoped), **or**
- `**budgets_list`** if one payload covers names + amounts per §1 budgeting UX.

Exact payloads locked during outcome catalog phase.

---

### `classify_inter_company_movements` — would AI need this?

**Only when** the assistant is clearing **warnings** that require persisted classification decisions (same as clicking through the UI warnings flow). Users who never reconcile inter-company flags do not need it.

**Plan:** Implement as `**warnings_resolve_inter_company_classifications`** (or shorter `warnings_submit_inter_company_labels`) **low priority**, with description: “Use when consolidated warnings/inter-company view shows items needing persisted labels.” Omit from “start here” tier.

---

### `renew_contract`

**Today’s server behavior:** Renewal is `**POST /api/contracts/:id/renew`** with a **validated JSON body** aligned with whatever the Contracts UI collects — **not** image upload (`[routes/contracts.ts](server/routes/contracts.ts)`). MCP tool should expose that contract (e.g. `contracts_request_renewal` carrying the same schema).

**Your desired flow (photo → extracted fields)** is **out of scope** for that route: plan a **later** `**contracts_renew_from_document`** pipeline (multipart/base64 OCR or human-assisted) rather than overloading renewal JSON.

---

### `get_contract_document_base64` (and ZIP exports) — why base64?

MCP tool results are **JSON-first**. Embedding raw bytes breaks most transports; `**base64` + `mimeType` + `byteLength`** matches existing invoice PDF tool (`[binary-oauth-upload-mcp-tools.ts](server/mcp/binary-oauth-upload-mcp-tools.ts)`).

**Yes, agents can turn that into real files:** decode base64 and write `{filename}` to disk locally; assistants are not obligated to parse PDF pixels inside the MCP boundary.

Prefer outcome name `**contracts_get_signed_pdf_base64`** over generic “get_contract_document” unless multiple doc types appear.

---

## Priority: income composition + financial safety + dashboard metadata

Your ask: expose **income composition**, **financial safety score** (with usable detail), and **dashboard-critical metadata**: expenses this FY, cash on hand, credit available, etc. — **composite for decisions**, not scattered calls only.

**Implementation approach:**

1. `**income_get_composition**` — same composer as `[GET /api/income-composition](server/routes/income-composition.ts)`; complements MCP resource URI for models that skip `resources/read`.
2. `**household_financial_posture**` — composite read assembling **only** existing composers (`analytics_get_financial_safety`-equivalent bundle, `**dashboard_get_summary**`, optional `**dashboard_get_balance` per account** when `includeBalancesByAccount`).

Explicit **non-duplication:** the snapshot tool **orchestrates** callers to existing read/mutation composers; no second copy of safety math (that lives in `[shared/financial-safety/compute.ts](shared/financial-safety/compute.ts)` via wired inputs).

---

## Gap list → preferred fix (outcome-first) — condensed


| Area                    | Prefer                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Income + posture        | `**household_financial_posture**` + `**income_get_composition**`                                                                                                 |
| Income composition only | `**income_get_composition**`                                                                                                                                     |
| Debts list              | `**debts_list**`                                                                                                                                                 |
| Fixed expenses reads    | `**fixed_expenses_snapshot**` (+ granular `**fixed_expenses_***` reads)                                                                                          |
| Budgets                 | `**budgets_get_category_names**`, `**budgets_list_lines**`, `**budgets_upsert**`, `**budgets_delete**`                                                           |
| Debt strategy           | `**debt_strategy_get_state**` (new read) + existing `**debt_strategy_***` mutations                                                                              |
| Deadlines writes        | `**deadlines_***`                                                                                                                                                |
| Obligations writes      | `**financial_obligations_***`                                                                                                                                    |
| Clients                 | `**clients_update**`                                                                                                                                             |
| Inter-company           | `**warnings_resolve_inter_company_***` (low priority)                                                                                                            |
| Contract renew JSON     | `**contracts_request_renewal**`                                                                                                                                  |
| Signed contract PDF     | `**contracts_get_signed_pdf_base64**`                                                                                                                            |
| Accountant exports      | **`accountant_readiness_snapshot`**, **`accountant_preview_*_bundle`**, **`accountant_send_*_bundle`** (optional fingerprint on preview/send for QA only) |
| Existing `get_ai_*`     | Canonical `**analytics_***` (paired aliases until sunset)                                                                                                        |
| Legacy `get_http_*`     | Canonical prefixed names below                                                                                                                                   |


---

## Design principles (generic AI)

1. **Canonical names are `domain_action`** (Appendix A); **legacy aliases** document their HTTP twin in tool descriptions until removed.
2. **Structured success/failure** — Stable keys (`ok`, `code`, `entity`, `nextSteps`).
3. **Preview vs commit** for risky writes where domain supports it.
4. **Single-call posture** — `household_financial_posture` + `income_get_composition`.
5. **`domain_action` mandatory** — first token = owning domain (`invoices_`, `deadlines_`, `net_worth_`, …). Legacy verb-first tools (`capture_net_worth_snapshot`, `sync_bank_feed`, `query_transactions`, `preview_monthly_invoice`) gain prefixed successors (`net_worth_capture_snapshot`, `bank_feed_sync`, `transactions_drill_query`, `invoices_preview_monthly`); aliases until cutover.
6. **Instructions + registry appendix** (`bank-mcp-server.ts`) — tiers, deprecation, why base64.
7. **Reuse canonical code paths** ([`engineering-standards`](.cursor/rules/engineering-standards.mdc)).
8. **Explicit non-goals** — Cookie session; OAuth redirects (except returning URL payloads).

---

## Execution phases

1. **Prefixed registry + dual registration PR** (`prefixed-registry-migration` todo).
2. `**household_financial_posture`** + `**income_get_composition**`.
3. Instructions + naming appendix in `[bank-mcp-server.ts](server/mcp/bank-mcp-server.ts)`.
4. Remaining snapshots and writes (`deadlines_*`, obligations, budgets GET, expenses reads).
5. Binary/export tools with explicit decode guidance.
6. Accountant **`accountant_readiness_*` / `preview_*` / `send_*`** real implementations (replace `accountant_pack_*` stubs).
7. **Optional docs** — Cursor MCP confirmation + allowlist (`mutation-human-approval-pattern`).
8. Tests (`server/mcp/*.contract.test.ts`, route/domain tests unchanged as source of truth).

---

## Appendix A — Canonical prefixed MCP tool registry (target names)

**Convention:** `snake_case`, `{domain}_{action_verb_or_noun_phrase}`. These are **MCP tool names** (not `/api/...` paths). During migration each may register alongside a **legacy alias** (`get_http_*`, `get_ai_*`, verb-first names); steady state keeps only the left-hand names below.

### Cross-domain / composites

- `household_financial_posture` — financial safety + dashboard summary + optional per-account balances (see body above)
- `income_get_composition` — §1.7 income composition JSON (same as `GET /api/income-composition`)

### `net_worth_*`

- `net_worth_capture_snapshot` — replaces legacy `capture_net_worth_snapshot`

### `analytics_*` (replaces `get_ai_*`)

- `analytics_get_liquidity`
- `analytics_get_pipeline`
- `analytics_get_runway`
- `analytics_get_snapshot`
- `analytics_get_financial_snapshot`
- `analytics_get_financial_safety`
- `analytics_get_spend_by_currency`

### `bank_feed_*` / `feed_*`

- `bank_feed_sync` — replaces `sync_bank_feed`
- `feed_oauth_enable_start` — replaces `post_feed_oauth_enable_start`
- `feed_oauth_truelayer_start` — replaces `post_feed_oauth_truelayer_start`

### `transactions_*`

- `transactions_drill_query` — replaces `query_transactions`

### `invoices_*`

- `invoices_preview_monthly` — replaces `preview_monthly_invoice`
- `invoices_commit_monthly` — replaces `commit_monthly_invoice`
- `invoices_list` — was `get_http_invoices`
- `invoices_get_draft` — was `get_http_invoice_draft`
- `invoices_get_supplier_month_gaps` — was `get_http_invoice_supplier_month_gaps`
- `invoices_generate` — was `post_http_invoice_generate`
- `invoices_reconcile` — was `post_http_invoice_reconcile`
- `invoices_get_pdf_base64` — was `get_http_invoice_pdf_base64`
- `invoices_upload_supplier_pdfs_base64` — was `post_upload_invoice_pdfs_base64`

### `accountant_*` (slice 2 — replace stub `accountant_pack_*`)

- `**accountant_readiness_snapshot`** — horizon + gap report (no outbound; see § Accountant bundles)
- `**accountant_preview_vat_bundle**` / `**accountant_preview_corporation_tax_bundle**` / `**accountant_preview_sa_bundle**` — collate + fingerprint; no send
- **`accountant_send_vat_bundle`** / **`accountant_send_corporation_tax_bundle`** / **`accountant_send_sa_bundle`** — outbound send; blast radius capped by owner-only routing in **`outbound`**

### `statements_*`

- `statements_upload_base64` — was `post_upload_statements_base64`
- `statements_list_years` — was `get_http_statements_years`
- `statements_list` — was `get_http_statements_index`
- `statements_check_quarter` — was `get_http_statements_quarter_check`
- `statements_list_accounts` — was `get_http_statements_accounts`
- `statements_list_by_account` — was `get_http_statements_by_account`
- `statements_list_invoice_uploads` — was `get_http_statement_invoice_uploads_list`
- *(planned)* `statements_export_bundle_base64` — accountant / zip parity

### `contracts_`*

- `contracts_list` — was `get_http_contracts`
- `contracts_get` — was `get_http_contract_by_id`
- `contracts_get_income_accrual_aggregate` — was `get_http_contracts_income_accrual`
- `contracts_get_expected_receipts` — was `get_http_contracts_expected_receipts`
- `contracts_get_income_accrual` — per-id; was `get_http_contract_income_accrual`
- `contracts_list_leave` — was `get_http_contract_leave`
- `contracts_book_leave` — was `post_http_contract_leave`
- `contracts_delete_leave` — was `delete_http_contract_leave`
- `contracts_preview_leave_notice` — was `post_http_contract_leave_preview`
- `contracts_request_renewal` — new outcome wrapper for renewal JSON
- `contracts_get_signed_pdf_base64` — signed PDF parity
- *(future)* `contracts_renew_from_document` — scan/OCR pipeline (not today’s `/renew`)

### `clients_`*

- `clients_list` — was `get_http_clients`
- `clients_update` — planned (HTTP `PUT` parity)

### `companies_*`

- `companies_list` — was `get_http_companies`

### `financial_obligations_*`

- `financial_obligations_list` — was `get_http_obligations`
- `financial_obligations_list_overdue` — was `get_http_obligations_overdue`
- `financial_obligations_get_vat_reconciliation` — was `get_http_obligations_vat_reconciliation`
- `financial_obligations_list_upcoming` — was `get_http_obligations_upcoming`
- `financial_obligations_list_upcoming_payments` — was `get_http_obligations_upcoming_payments`
- `financial_obligations_list_dismissals` — was `get_http_obligations_dismissals`
- *(planned write set)* `financial_obligations_create`, `financial_obligations_update`, `financial_obligations_delete`, `financial_obligations_upsert_state`, `financial_obligations_reset_state`, `financial_obligations_dismiss_auto`, `financial_obligations_undismiss_auto` … (final verbs = route-aligned)

### `deadlines_`*

- `deadlines_list` — was `get_http_deadlines`
- `deadlines_get_feed` — was `get_http_deadlines_feed`
- `deadlines_get` — was `get_http_deadline`
- *(planned writes)* `deadlines_create`, `deadlines_update`, `deadlines_remove`, `deadlines_mark_done`, `deadlines_clear_done`

### `tax_`*

- `tax_get_vat_payments` — was `get_http_tax_vat_payments`

### `warnings_*`

- `warnings_get_consolidated` — was `get_http_warnings_consolidated`
- `warnings_get_entity_foundation` — was `get_http_warnings_entity_foundation`
- `warnings_get_inter_company_movements` — was `get_http_warnings_inter_company_movements`
- *(planned, low priority)* `warnings_resolve_inter_company_classifications`

### `dashboard_`*

- `dashboard_get_summary` — was `get_http_dashboard_summary`
- `dashboard_get_balance` — was `get_http_dashboard_balance`
- `dashboard_list_accounts` — was `get_http_dashboard_accounts`
- `dashboard_get_feed_toolbar_state` — was `get_http_dashboard_feed_toolbar_state`
- `dashboard_list_categories` — was `get_http_dashboard_categories`
- `dashboard_list_transactions` — was `get_http_dashboard_transactions`

### `forecast_*`

- `forecast_get` — was `get_http_forecast`

### `runway_*`

- `runway_get` — was `get_http_runway` (**distinct** from `analytics_get_runway`)

### `public_holidays_`*

- `public_holidays_list` — was `get_http_public_holidays`

### `app_*`

- `app_get_version` — was `get_http_version`

### `debts_*`

- `debts_create` — was `post_http_debts`
- `debts_update` — was `put_http_debts`
- `debts_archive` — was `delete_http_debts`
- `debts_set_opening_balance` — was `post_http_debts_opening_balance`
- `debts_list` — *(planned read)* parity with `GET /api/debts`

### `debt_strategy_`*

- `debt_strategy_create_plan` — was `post_http_debt_strategy_plans`
- `debt_strategy_activate_suggested_plan` — was `post_http_debt_strategy_activate_suggested`
- `debt_strategy_acknowledge_movement` — was `post_http_debt_strategy_movement_acknowledge`
- `debt_strategy_dismiss_missed_movement` — was `post_http_debt_strategy_movement_dismiss_missed`
- `debt_strategy_pause_plan` — was `post_http_debt_strategy_plan_pause`
- `debt_strategy_resume_plan` — was `post_http_debt_strategy_plan_resume`
- `debt_strategy_delete_plan` — was `delete_http_debt_strategy_plan`
- `debt_strategy_sandbox_what_if` — was `post_http_debt_strategy_sandbox`
- `debt_strategy_get_state` — *(planned read)* parity with `GET /api/debt-strategy/state`

### `budgets_`*

- `budgets_upsert` — was `post_http_budgets`
- `budgets_delete` — was `delete_http_budgets`
- `budgets_get_category_names` — *(planned)*
- `budgets_list_lines` — *(planned)* list rows for `account`

### `fixed_expenses_`*

- `fixed_expenses_put_simulation_exclusions` — was `put_http_expenses_simulation_exclusions`
- *(planned reads + snapshot)* `fixed_expenses_get_overview`, `fixed_expenses_get_simulation_exclusions`, `fixed_expenses_list_ad_hoc`, `fixed_expenses_get_ad_hoc_series`, `fixed_expenses_list_recurring`, `fixed_expenses_snapshot`

---

### Appendix B — Write-tool prefix examples (obligations + deadlines recap)


| Domain                    | Prefix                   | Examples                                                                                                  |
| ------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| Calendar / reminders CSV  | `deadlines_`             | `deadlines_create`, `deadlines_update`, `deadlines_mark_done`, `deadlines_clear_done`, `deadlines_remove` |
| Registry + statutory rows | `financial_obligations_` | `financial_obligations_create`, `financial_obligations_update`, …                                         |
| Client registry           | `clients_`               | `clients_update`                                                                                          |
| Contracts                 | `contracts_`             | `contracts_request_renewal`, `contracts_get_signed_pdf_base64`                                            |


---

## Related docs

- Supersedes ambiguous examples in chat (e.g. bare `complete_deadline` → use prefixed names in appendix when implementing).  
- Monthly invoice epic: `[.cursor/plans/mcp-parity-external-actions.plan.md](.cursor/plans/mcp-parity-external-actions.plan.md)`.

