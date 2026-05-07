# Feature Roadmap

> This app is not a finance tracker. It is a **threat elimination system for financial surprises**.
>
> Everything below is organized around one principle: closing the gap between "I can see what happened" and "nothing can surprise me."
>
> **What's shipped (Tier 0):** obligations registry, HMRC auto-seeders (VAT / CT / SA / TTP), **budgets** (monthly + yearly vs actual on the **Accounts** tab, plus **nudges** for high-spend merchants without a budget line), **household liquidity** on the **Dashboard** tab (`GET /api/dashboard/summary`): **`liquidityOverview`** (GBP **cash vs credit** split, static FX, per-account breakdown) plus **`liquidityCommitments`** — **rolling 12 calendar months** from today (obligations in window + projected fixed recurring from `runExpensesOverviewPipeline`; **cash after commitments** = cash-only, signed on the wire, headline floored at £0; **Save ahead** flags for lines ≥ threshold; overlap footnote), same subtree on **`GET /api/ai/liquidity`** / MCP liquidity resource; recurring detection, overdue hero, missed-obligation detector, multi-currency foundations (GBP + AED), and the Deadlines tab + calendar + ICS export.
>
> **What's shipped (Tier 1):** **Multi-Entity Foundation (1.1)**, **Clients, Contracts & Renewals (1.2)** phases A–E, **Invoicing (1.3)** Phases 1–4 (incl. payment reconciler with FX), **Working-Days Ledger (1.4)** with public holidays + leave calendar, **Cash Flow Forecast (1.5)** at `GET /api/forecast`, **Worst Case / Runway (1.6)** at `GET /api/runway` (household-first, GBP + AED dual headline, entity drill-down, credit headroom; **Strategy** tab hero uses `holisticGbp` from this API — **accrual off**, “contracts stop paying”; the **sandbox** `assembleRunwayScenario` uses **accrual on** plus optional income exclusions, so “cash runs out” can legitimately differ), and **Income Composition & Diversification (1.7)** at `GET /api/income-composition` (metrics + typed `riskSignals[]`, `properties/` registry).
>
> **Tier 2 started:** ~~**§2.1 Financial Snapshot**~~ ✅ **SHIPPED** — **`GET /api/ai/financial-snapshot`**, MCP **`bankstatements://ai/financial-snapshot`**, **`AiFinancialSnapshotResponseSchema`**, manifest **`AI_MANIFEST_SCHEMA_VERSION` 2.1.3** (composed: liquidity + `liquidityCommitments`, near-term obligation window, runway `holisticGbp`, outstanding invoices + aggregate accrual, discretionary, budget nudges, verdict). See **§2.1** for deferred nuance (near-term sum = pipeline obligations only).
>
> **What's next (Tier 2):** **§2.2 Financial Safety Score** (multi-factor “am I safe?” — **liquidity vs commitments, runway, income durability / contract runway, expense & debt load**; §1.8 warnings as a **secondary modifier**, not the sole driver). Then **§2.3 Warnings metadata & agent ergonomics** — richer, stable warning identity + routing hints + optional user/orchestrator state stored **in this app** so MCP clients and external orchestrators can dedupe, prioritise, and drive actions without re-parsing prose. **Channels** (WhatsApp, email, Slack, *etc.*) and **conversational orchestration** stay **outside** this repo (separate agent stack). Context unchanged: two entities (UK Ltd + UAE FZCO), agency and direct clients, mixed self-bill and supplier-issued mechanisms.
>
> **Below:** Tier 0–1 narrative unchanged; **§2.0** foundation + **§2.0.H** extended AI surface remain as documented. **§2.4** (in-repo chat) is **not** a tracked milestone — see strikethrough heading under **§2.3**.

---

## Tier 0 — Certainty Layer ("Nothing Can Surprise Me") ✅ COMPLETE

### 0.1 Deadlines Tab + Calendar View ✅ SHIPPED

- **Deadlines tab** with List + FullCalendar Calendar views.
- Non-financial deadlines in `deadlines/deadlines.csv`; CRUD at
  `/api/deadlines`.
- Unified `/api/deadlines/feed` merges non-financial deadlines with
  financial obligations via a pure `buildDeadlineFeed()` reused by
  the feed endpoint and the ICS exporter.
- **ICS subscription** at `/api/deadlines.ics` with stable UIDs and
  a `SEQUENCE` derived from `updatedAt` so edits propagate to
  subscribers.

---

### 0.2 Dashboard vs Accounts shell ✅ SHIPPED

- **Dashboard** tab (default): household **liquidity** — hero **"Household liquidity"** with **four headline tiles**: Cash & savings, Credit available, **Committed (12 mo)**, **Cash after commitments** (headline uses **max(0, model)**; API returns signed `cashAfterCommitmentsGbp`). Below: **two-column** breakdown (cash accounts | credit cards), then full-width **committed outflows** panel with horizon label (`horizonStartDate` → `horizonEndDate`, **+12 calendar months** from today, **not** tied to the FY selector). Static FX note and footnotes (credit not netted into cash-after; obligations vs recurring may overlap).
- **Domain:** `server/domain/accounts/liquidity-commitments.ts` — `buildLiquidityCommitments({ todayIso, totalCashGbp })`; obligations via `getAllObligations` (`minDueDate` ≈ today−365 for overdue capture, `maxDueDate` = horizon end); recurring from `runExpensesOverviewPipeline()` (monthly × month-buckets in range; annual when due falls in window). **`significantThresholdGbp`** (default £2,000) drives **Save ahead** in UI.
- **API:** `GET /api/dashboard/summary` → `liquidityCommitments` (always built when balances load — **independent of selected FY**). **`composeAiLiquidity`** includes the same block; **`AiLiquidityResponseSchema`** + MCP liquidity resource parity (contract tests).
- **Deferred / vNext (not shipped):** dedupe obligation vs recurring for the same underlying bill; optional accountant-adjusted CT override in commitments total; richer “discretionary vs mandatory” split on the dashboard.
- **Accounts** tab: FY filter, charts, budgets, VAT, balance editing — unchanged analytics surface; loads the same summary on first visit (lazy).

---

## Tier 1 — Projection Layer ("What's Coming")

### 1.1 Multi-Entity Foundation ✅ SHIPPED

- Two-entity company registry (UK Ltd + UAE FZCO); `entityId` on every account, including the `wise-ltd` intermediary.
- Jurisdiction-scoped tax rules (UK VAT / CT / SA, UAE VAT / CT) drive every VAT / CT query via the `accounts` registry indexes.
- Inter-company pair-finder for cross-entity transfers, with classification overrides for loan / capital / service-fee flows.
- `/api/warnings/entity-foundation` surfaces TBC fields, FZCO CT status, UAE VAT thresholds, IFZA renewal, and unclassified inter-company movements.
- IFZA license renewal flows through the unified deadlines feed + ICS.

### 1.2 Clients, Contracts & Renewals ✅ SHIPPED (Phases A–E)

Structural anchor for every income-side calculation. Both **agency-mediated** (e.g. La Fosse → Edwin) and **direct** (e.g. Delta Capita) shapes are first-class.

- **A — Registries + renewal deadlines.** Canonical `clients`, `master-agreements`, and `contracts` registries with build-time FK joins; renewal deadlines auto-seeded into the unified deadlines feed + ICS.
- **B — Templates + recipient routing.** Pure `renderTemplate` + `resolveRecipients` over `.hbs` files (`leave`, `sickness`, `invoice-cover`, `renewal`); per-client overrides; structured errors. Consumed today by 1.2.E leave preview; any future template-driven outbound comms would use the same primitives (delivery **outside** this repo unless explicitly added later).
- **C — Timeline-aware payer matcher.** `matchPayerToContract` resolves transactions to active contracts via the `byClientAndEntity` index. `payment-outside-contract-window` joins the entity-foundation warnings feed.
- **D — Clients page UI.** End-client-first tiled view; agency rows surface twice (agency block + end-client block); `PUT /api/clients/:id` is the sole write path with kind-flip protection; `client-tbc-fields` warnings render as per-tile badges.
- **E — Contracts tab.** Per-contract accrual + Retained-after-tax banner; Book Leave flow writes to `working-days/leave.csv` via a canonical leave registry; `GET /api/contracts/:id/income-accrual` derives worked / accrued / projected days from the `works_*` weekday mask minus leave (and public holidays via 1.4); accrual rebases onto the last matched invoice payment.

### 1.3 Invoicing System ✅ SHIPPED (Phases 1–4)

One ledger (`invoices/invoices.csv`) and one **Invoices** tab, with behaviour driven by each contract's `invoice_mechanism`.

- **Supplier-issued:** server draft → persist → PDF (`/api/invoices/draft`, `/generate`, `/:id/pdf`).
- **Self-bill:** multi-PDF ingest with a parser registry (La Fosse today).
- **Phase 4 — Payment reconciler.** `invoice_payments.csv` is the canonical bank-line ↔ invoice link. `POST /api/invoices/reconcile` runs a global-greedy match with date / amount / reference scoring, optional FX with gain/loss and residual, and warnings (stale reference, bad due / period, unmatched deposits) on the entity-foundation feed. Contracts accrual rebases on reconciled payments first, heuristics second.

### 1.4 Working-Days Ledger ✅ SHIPPED

Income-side counterpart to obligations: public holidays + leave calendar + invoice day-count reconciliation.

- Public holidays via `date-holidays` (UK + UAE), filtered to `type === 'public'`, with the UK Summer bank holiday patched in. Served at `GET /api/public-holidays`.
- `calculateWorkload` accepts public-holiday dates and unions them with leave into `excludeDates`; every consumer (accrual, invoice draft, projections) is holiday-aware automatically.
- 17 implied-leave seed rows reverse-computed from historical DC invoices.
- FullCalendar leave calendar on the Contracts tab; click a weekday to toggle leave for all active contracts.
- `invoice-days-mismatch` warning on the entity-foundation feed when billed days disagree with the ledger.

### 1.5 Cash Flow Forecast / Runway Projection ✅ SHIPPED

`GET /api/forecast?days=…&entityId=…` — pure `buildForecast` walks a daily timeline over obligations, projected recurring, unpaid invoice receipts, and un-invoiced contract accrual (1.4-aware workload). Returns per-entity 30/60/90 snapshots in each currency plus per-account daily series. API only; no UI in this phase. This is the projection spine for 1.6+ and Tier 2.

### 1.6 Worst Case / Runway Mode ✅ SHIPPED

`GET /api/runway?days=…&entityId=…&detail=summary|accounts` — household-first stress view answering *"if all active contract income stops today, how long can the household last?"*

- **Holistic headline by currency:** `household.GBP` and `household.AED`, each with full vs mandatory-only runway months, first stress date, total cash, and total available credit. No silent GBP+AED blend.
- **Two stress lanes:** `stress.fullRecurring` (all detected recurring spend) and `stress.mandatoryRecurring` (bills only, via `isMandatoryCategory` / `NON_QOL_CATEGORIES`).
- **Drill-down:** entity rollups in each lane; optional per-account daily series via `?detail=accounts`.
- **Credit model:** `openingBalance` is the credit line; `currentBalance` is remaining headroom. Optional read-only `creditLimit` alias on the balance API (= `openingBalance` for credit cards). Dashboard balance panel labels switch to "Credit limit" via `getAccountConfig`.
- **DRY engine:** shared `assembleForecastEvents` for `/api/forecast` and `/api/runway`; recurring QoL split lives in `shared/expenses-insight.ts`.
- **UI:** **Strategy** tab (`GET /api/runway` → `holisticGbp`) shows consolidated GBP “cash runs out” for the **no contract accrual** stress path. **Warnings** tab carries threshold breaches (`runway-low`, etc.). **Sandbox** on Strategy (`POST /api/debt-strategy/sandbox` → `assembleRunwayScenario`) replays **accrual-on** cash path with optional income line exclusions — expect a **later** stress date than the hero unless income is unchecked.

### 1.7 Income Composition & Diversification ✅ SHIPPED

`GET /api/income-composition` — three single-mode-risk metrics + typed risk signals, composed read-only over existing registries.

- **Income at face value.** Joins contracts + rental obligations + recurring-pipeline detected income (deduped) into a uniform `IncomeSource` list. Rental income is gross; mortgage + insurance stay in mandatory outgoings (no netting on either side, symmetric).
- **Three metrics, primitives travel with each.** `clientConcentration`, `activePassiveRatio`, `timeIndependence` — every metric exposes its numerator and denominator so consumers compose their own caveats. Per currency household + per-`(entityId, currency)` drill-down. No GBP+AED blend.
- **`riskSignals[]` typed discriminated union** — each variant inlines primitives next to `code` and `severity`, no baked prose. Codes: `client-concentration-{extreme,elevated}`, `time-independence-{low,elevated}` (with `additionalPassiveNeeded` / `mandatoryReductionNeeded` math), `mode-concentration-extreme`, `passive-income-zero`, plus `leveraged-passive-income` per property (`grossMonthly`, `mortgageMonthly`, `netMonthly`, `netToGrossRatio` — surfaces leverage as a signal without fudging income).
- **New canonical `properties/` registry** owns the rent ↔ mortgage join via `property_id`. Three seed rows; nullable `property_id` column added to `obligations.csv`; rental-income rows must reference one. Cross-registry FK integrity test locks it.
- **`server/domain/income-composition/`** is a service module (not a registry — same shape as `forecast/`); listed in `NON_REGISTRY_DIRS`.
- **`riskSignals[]`** are bridged onto the Warnings tab (§1.8).

### 1.8 Solvency Warnings Engine (the Warnings tab) ✅ SHIPPED

The Warnings tab is the **consolidated, severity-sorted spine** for
every warning the app emits. §1.1's entity-foundation feed plus the
§1.6 runway, §1.7 income-composition, tax-reserve and ad-hoc-spend
emitters all populate the same surface, filterable by entity, and
each warning carries typed primitives in `context` so AI / future
surfaces don't parse prose.

- Schema additively extended with optional `entityId` and `context`
  primitives; legacy emitters keep working unchanged.
- New emitters: runway thresholds (`runway-low`, `runway-mandatory-low`,
  `trapped-cash`); income-composition risk-signal bridge (concentration,
  time-independence, mode-concentration, passive-income-zero,
  leveraged-passive-income); tax-reserve under-funded / trajectory-
  missing; ad-hoc spend escalation (rolling 30d / 90d / MoM bands).
- New `reserves/` registry maps `(obligation_type, entity_id)` →
  reserve account. Replaces today's `showTaxLiabilities` display
  flag with a real policy.
- `warning_snapshots` table + snapshot-diff emit `warning-improved` /
  `warning-cleared` (severity `info`) so risk reduction is visible
  between days.
- Single endpoint: `GET /api/warnings/entity-foundation` (legacy name)
  + `GET /api/warnings/all` (forward-naming alias). The frontend
  Warnings tab gains an entity filter and an optional source-group
  toggle; existing CSS classes reused.
- The warning schema is a **primary spine** for §2.3; it is one **input** (risk modifier) to §2.2 alongside liquidity, runway, and income — see **§2.2**.
- **Leveraged-passive-income:** property leverage uses `debt.matchAmounts[0]` per property (not pipeline pattern sums that merged distinct mortgages); optional `match_tolerance_pct` on debts; regression tests lock behaviour.

### 1.9 Debt Strategy Advisor ✅ SHIPPED

Goal-driven planner (clear a debt / save for a target): standing-order instructions, three intensities, feasibility (`ok` / `degraded` / `infeasible` with typed `suggestedRemedies`), refinance trade-off (always three plans). Composes §1.5–§1.8 + budgets. **Behavioural contract:** QoL budgets inviolable; malleable adjustable in UI; no silent replan on data drift; suggested plans are route-only until activated.

- **Data:** `debt-strategy/plans.csv`, `movements.csv`; `CategoryConfig.qol` in categorizer; optional `AccountConfig.creditCard` for APR/promo (refinance blocked until seeded — `account-credit-card-config-missing`).
- **Code:** `server/domain/debt-strategy/` (`assembleDebtStrategy`, headroom, `generate-plan`, `present-intensity-options`, `auto-suggest-plans`, etc.).
- **Warnings:** 12 codes on `/api/warnings` with typed `context`; movement detection reuses `doAmountsAndDatesMatch` with ±3d / exact amount; `lost-contract.test.ts` locks income-drop → degraded/infeasible.
- **API:** `GET /api/debt-strategy/state`, `POST` plan lifecycle + movement acknowledge/dismiss, `POST /api/debt-strategy/sandbox` (what-if state + `scenarioHolisticGbpRunway`; **accrual-on** runway vs hero — see §1.6).
- **UI:** **Strategy** tab — suggested / active / completed + sandbox. **Debt** tab remains raw debt register. **Budgets** tab — read-only QoL/Malleable pills.

**Deferred:** Open Banking–initiated transfers; auto-derived budget defaults; cross-plan optimisation beyond FCFS; FZCO save-for-target without AED savings; UI editing of QoL tags; plan audit log.

---

## Tier 2 — AI Agent Layer ("Proactive Guardian")

### 2.0 Structured Data for AI Consumption (agent prerequisite)

Before any external AI assistant
(ChatGPT / Claude / MCP bridges) can be trusted with real analysis
of this data, the app needs a small, well-named set of endpoints
whose field semantics are unambiguous.

**Motivation (real incident, 2026-04-24).** A first-pass AI analysis
driven by the existing API read `currentBalance` on three credit-card
accounts as £36k+ of cash when those fields actually held £36k+ of
*available credit*. The same pass quoted the naive `net × 25%`
Corporation Tax estimate as a live liability and ignored that the
accountant has reduced CT by ~80% two years running. Both mistakes
were possible because the current JSON conflates distinct concepts
under shared field names. No UI change can protect the agent layer
from this — the primitives themselves have to carry their own
semantics.

**Design philosophy.** A single mega `/api/ai/snapshot` is *not* the
right primary surface: it breaks sub-domain isolation, forces over-
fetching, and re-introduces the "what does this field mean for *this*
account?" ambiguity inside a larger blob. The pattern that has
actually worked for LLM tool-use elsewhere (MCP, OpenAI
function-calling, Claude tool-use) is:

1. Fix the semantic drift at the primitive level (2.0.A + 2.0.B).
2. Ship a handful of small, well-scoped composed views the agent
   actually needs (2.0.C–2.0.E).
3. *Then* ship a thin `/api/ai/snapshot` that orchestrates the
   composed views — documented as "prefer slices when you only need
   a slice" (2.0.F).
4. Ship an `/api/ai/manifest` (OpenAPI-style) so any AI consumer can
   auto-discover the tool menu instead of guessing field meanings
   (2.0.F).

**Gate.** Blocks Tier 2 numbering **§2.1–§2.3** as defined below until 2.0 acceptance criteria pass. (**Former §2.4** in-repo chat/WhatsApp is **out of scope** — use an external orchestrator + this app’s HTTP/MCP.)

#### 2.0.A Balance semantics — explicit discriminator

Problem: `/api/dashboard/balance/:account` returns `currentBalance`
with three different meanings depending on the account:

- **Cash held** (Barclays Current, Barclays Savings, NatWest,
  NatWest Savings, Monzo Joint, Emirates Islamic, Wise).
- **Credit remaining** (Capital on Tap, Barclaycard — because
  `openingBalance` was seeded with the credit limit and purchase
  transactions are negative).
- **Debt owed** as a negative number (Santander Everyday — seeded
  at zero, usage logged as negative).

Add an explicit discriminator to every balance response:

```json
{
  "account": "capital-on-tap",
  "balanceSemantics": "credit-remaining",
  "cashBalance": null,
  "creditLimit": 30000,
  "creditUsed": 1247.30,
  "creditRemaining": 28752.70,
  "debtOwed": 1247.30,
  "openingBalance": 30000,
  "currentBalance": 28752.70
}
```

`balanceSemantics` values: `cash`, `credit-remaining`, `debt-owed`,
`passthrough`. The legacy `openingBalance` / `currentBalance` fields
stay for back-compat, but the agent reads from the explicit fields.

Same cleanup on `/api/debts`: add `debtKind: 'amortising-loan' |
'revolving-credit' | 'mortgage'` and let the response shape switch
on it. `paidSinceOpening` and `payoffProgress` are meaningless for a
revolving credit card; emitting them either as `null` or not at all
removes the class of mistake entirely.

#### 2.0.B Accountant-adjusted tax liability

Problem: the auto-CT obligation is `net × CORPORATION_TAX.MAIN_RATE`.
Two consecutive years, the lived-experience outcome has been
naive ~£30k → actual ~£5k (~83% reduction via expense optimisation).
The naive figure is useful as a ceiling, but surfacing it as
`expectedAmount` with no context scares both humans and AIs into
over-reserving £30–40k of phantom liability.

Add to `autonize-it/company.csv`:

- `historical_effective_ct_rate` — rolling average over the last N
  filed years (nullable until a filed year exists).
- `historical_effective_vat_rate` — same pattern for VAT if the
  accountant legitimately optimises input VAT reclaim.

The obligations calculator emits **both** figures on every CT row,
never one or the other:

```json
{
  "type": "corporation-tax",
  "expectedAmount": 8166.50,
  "naiveAmount": 48666.50,
  "adjustmentBasis": "historical_effective_ct_rate: 0.17 (2-year mean)",
  "adjustmentSource": "company.historical_effective_ct_rate"
}
```

Rule: the naive figure is never discarded. The UI and the agent see
both, so the accountant's value-add is legible at a glance and the
adjusted figure can never silently drift from the naive one.

#### 2.0.C Expected-receipts calendar

Problem: `/api/contracts/income-accrual` answers "how much have I
earned this month?", not "when does the money hit which account?".
For worst-case reasoning, landing dates matter more than accrual
totals — "£25k arrives May 31st" and "£25k arrives June 15th" are
the same accrual but very different survival stories.

New endpoint `GET /api/contracts/expected-receipts`:

```json
{
  "items": [
    {
      "contract_id": "dc-sow-2026",
      "period": "2026-04",
      "amount_net": 12100,
      "amount_incl_vat": 14520,
      "currency": "GBP",
      "issuing_entity_id": "autonize-it-ltd",
      "invoice_status": "accrued-not-yet-issued",
      "expected_invoice_date": "2026-05-01",
      "payment_terms_days": 30,
      "expected_landing_date": "2026-05-31",
      "expected_landing_account": "barclays-current"
    }
  ],
  "by_month": { "2026-05": { "gbp": 25520 } }
}
```

Derived purely from `contracts.csv` × `invoice_cadence` ×
`payment_terms_days` × the already-computed accrual. No new source
of truth.

#### 2.0.D Contract renewal monetary exposure

Problem: the `contract-ending-soon` warning says "6 days" but not
"£12,100 gross / £9,075 retained per month at risk, which is 100%
of this entity's active revenue". The date alone panics; the monetary
figure makes it actionable.

Enrich the existing warning payload:

```json
{
  "code": "contract-ending-soon",
  "contract_id": "dc-sow-2026",
  "end_date": "2026-04-30",
  "days_until": 6,
  "monthly_exposure_gross": 12100,
  "monthly_exposure_retained": 9075,
  "percent_of_entity_revenue": 100
}
```

Reuses `calculateRetainedReserves` from 1.2.E — no new tax logic,
just exposure arithmetic.

#### 2.0.E Composed AI views (slice-shaped)

Three small composed endpoints, each with a single clear purpose.
These are the *primary* surface for agent reads:

- `GET /api/ai/liquidity` — composed today: **`liquidityOverview`** + **`taxLiabilities`** + optional **`byEntity`**, and **`liquidityCommitments`** (rolling 12-month committed model + `significantThresholdGbp`, same as dashboard summary). *(Original 2.0.E sketch also listed per-field cash/credit/debt slices; shipped shape is Zod-locked in `AiLiquidityResponseSchema`.)*
- `GET /api/ai/pipeline` — expected receipts (2.0.C) + upcoming
  obligations (existing) merged onto a single dated timeline, per
  account. Answers "what lands when?" in one call.
- `GET /api/ai/runway` — N-day zero-new-income projection per
  entity: what is the balance on day N if no new contracts land?
  Fed by 2.0.C + recurring detector + obligations. Day-resolution,
  not month-bucketed.

#### 2.0.F Snapshot + manifest

- `GET /api/ai/snapshot` — thin composition of 2.0.E with a header
  (`today`, `generated_at`, `schema_version`, `warnings_summary`).
  Documented as "single-shot reasoning only; prefer slice-specific
  views when you need just one concern". This is *not* the primary
  agent surface — it is a convenience wrapper.
- `GET /api/ai/manifest` — generated OpenAPI-shaped catalogue of
  every `/api/ai/*` endpoint (and the enriched warnings / balances /
  obligations feeds) with field-level `description`, `semanticUnit`
  (`GBP-cash`, `GBP-credit-remaining`, `days`, `percent`, etc.) and
  example values. **Generated, not hand-written** — drifting schema
  can't silently mislead a future agent. This is what an MCP bridge
  or ChatGPT plugin would consume first.

#### 2.0.G MCP server (thin adaptor over the slice endpoints)

Once 2.0.A–F are stable, wrap the same slice endpoints as a first-
class **Model Context Protocol** server so that any MCP-aware client
(Cursor, Claude Desktop, ChatGPT via bridge, future Open Close, any
new IDE that adopts the spec) can attach with zero bespoke
integration. The REST surface stays — it powers the web UI and stays
the canonical business logic. MCP is a **delivery channel**, not a
competing implementation.

**Design rules (non-negotiable).**

- MCP is a **thin adaptor**. Target ≤ ~300 lines of glue. If the
  adaptor starts re-implementing business logic it has drifted from
  its role — back it out and move logic into the slice endpoints.
- Tool / resource descriptors are **generated** from
  `shared/api-contracts.ts` Zod schemas via `zod-to-json-schema`.
  Hand-written descriptors are banned so the MCP surface cannot
  drift from the REST contracts it wraps (same rule as
  `/api/ai/manifest` in 2.0.F).
- **Resources vs tools split is load-bearing**, not decorative:
  - **Resources (read-only, safe to expose to any LLM):** `finance://liquidity`,
    `finance://pipeline`, `finance://runway`, `finance://snapshot`,
    `finance://warnings`, `finance://contracts`,
    `finance://contracts/{id}`, `finance://obligations/upcoming`,
    `finance://debts`. Every resource is a pure projection of a
    2.0.E slice endpoint.
  - **Tools (mutations, human-in-loop required):** `book_leave`,
    `mark_contract_renewed`, `dismiss_warning`,
    `set_account_opening_balance`, `upload_statement`. Each tool
    descriptor carries explicit confirmation metadata (tool
    annotation flagging destructive / irreversible behaviour) so
    Cursor / Claude Desktop prompt the user before execution. Query-
    only tools (`compute_runway`, `project_receipts`) are allowed but
    should prefer resources where the call is parameter-free.
- **Two transports, same server:**
  - `stdio` for local use (Cursor attaching to the dev server,
    Claude Desktop, on-device Open Close). Zero-auth, filesystem-
    speed, the default.
  - `HTTP+SSE` (or the current MCP streamable-HTTP transport) for
    remote use (WhatsApp agent, hosted Open Close, ChatGPT bridge).
    Gated behind a static bearer token read from env; off by
    default.

**File layout.**

```text
server/mcp/
  server.ts              creates an MCP Server, registers transports
  resources.ts           finance://* handlers (each = thin wrapper
                         over a 2.0.E slice endpoint)
  tools.ts               book_leave / mark_contract_renewed / etc.
                         (each = thin wrapper over existing
                         /api/* mutation routes, with MCP
                         confirmation annotations)
  descriptors.ts         auto-generates tool + resource schemas
                         from shared/api-contracts.ts (Zod →
                         JSON Schema) — *this file is the contract
                         drift guard*
  transports/
    stdio.ts
    http-sse.ts
  mcp-server.test.ts     contract tests: every resource URI matches
                         the underlying REST response 1:1; every
                         tool descriptor is generated from a Zod
                         schema (no hand-written schemas allowed —
                         lint rule).
```

**What this unlocks immediately.**

- Cursor can answer questions about your live finances inside the
  IDE (attach `server/mcp/server.ts` via stdio in `.cursor/mcp.json`).
- Claude Desktop can do the same.
- Any future agent or orchestrator becomes an MCP
  *client*, so swapping the underlying model (Claude / GPT-5 /
  Qwen / local) is a config change, not a rewrite.
- Remote LLMs (ChatGPT via bridge) consume exactly the same surface
  a local LLM does, with only the transport differing.

**Acceptance criteria for 2.0.G.**

- An unmodified Cursor client, pointed at `server/mcp/server.ts`
  via stdio, can answer the same seven questions listed in the
  2.0 acceptance criteria — with **no additional code** beyond MCP
  configuration.
- Every resource handler returns byte-identical content to its
  underlying `/api/ai/*` slice (regression-locked in
  `mcp-server.test.ts`).
- No tool descriptor in `server/mcp/tools.ts` is declared by hand;
  all are derived from Zod schemas in `shared/api-contracts.ts`.
  A CI lint rejects hand-written descriptors.
- Mutation tools refuse to execute without an explicit
  confirmation annotation in their descriptor. Missing annotation
  = tool does not register at startup.
- `stdio` transport works with zero configuration; `HTTP+SSE`
  transport refuses to start unless an `MCP_BEARER_TOKEN` env var
  is set.

**Order within 2.0.** 2.0.G lands *after* 2.0.A–F because it has
nothing of its own to test until the slice endpoints and the
generated manifest exist. It closes out the **initial** 2.0 tranche.

#### 2.0.H Extended AI surface — insights, spend behaviour & MCP parity ✅ SHIPPED

Liquidity, pipeline, runway, and snapshot answer **survival and timing** questions well. This milestone widened **discoverability** so agents reading only **`GET /api/ai/manifest`** and **MCP** `bankstatements://ai/*` can fetch the **same** Tier 1 JSON as the app: consolidated **warnings** (`GET /api/ai/warnings` ↔ `GET /api/warnings/all`), **income composition**, **debt strategy** read bundle, **spend-context** (overview + default recurring + ad-hoc in one object), plus manifest entries for **`GET /api/expenses/{overview,recurring,ad-hoc}`**. Implementation follows **2.0.E–G**: thin composers and **`server/domain/warnings/consolidated-feed.ts`** / shared expense read-builders—**no** second categorisation or warning derivation in MCP.

**Shipped in this repo.**

- **`AI_MANIFEST_SCHEMA_VERSION`** — **2.1.0** shipped the expanded `slices[]` and `contractSchemaExports` (warnings, income-composition, debt-strategy, spend-context, expenses routes); **2.1.2+** adds **`LiquidityCommitmentsOverviewSchema`** for nested **`liquidityCommitments`** on the liquidity slice (dashboard parity); **2.1.3** adds **`AiFinancialSnapshotResponseSchema`** for **`GET /api/ai/financial-snapshot`** (§2.1).
- **HTTP** — `GET /api/ai/warnings`, `/income-composition`, `/debt-strategy`, `/spend-context`, **`/financial-snapshot`** (§2.1; manifest **2.1.3+**) in `server/routes/ai.ts`.
- **MCP** — matching resources in `server/mcp/bank-mcp-server.ts`; parity in `server/mcp/bank-mcp-server.contract.test.ts` and `server/routes/ai-parity.test.ts`.
- **Debt-strategy JSON** — `debtStrategyBundleToResponseJson` materialises Maps/Sets (including nested `forecastInputs`) so wire JSON matches `JSON.stringify` semantics for agents; **`GET /api/debt-strategy/state`** uses the same helper (UI unchanged where it only consumes top-level plan/headroom fields).

**Deferred (optional, as in original plan).** Extending **`GET /api/ai/snapshot`** with condensed warnings/spend/income summaries is **not** done; agents fetch slices separately.

**Interpretive / qualitative questions** remain **out of scope** as dedicated endpoints.

**Acceptance for 2.0.H.** Full **`npx vitest run`** green; manifest lists new slices; MCP matches composers; no duplicate business logic in MCP; contracts in `shared/api-contracts.ts` (e.g. `DebtStrategyStateResponseSchema`, `AiSpendContextResponseSchema`).

**Gate.** Delivers agent parity on Tier 1 insight; **§2.1** Financial Snapshot shipped on this foundation (see §2.1).

#### 2.0 acceptance criteria

An AI consumer that only reads `/api/ai/manifest` and the slice
endpoints must be able to correctly answer every one of:

1. How much real cash do I have, per entity and total?
2. How much credit headroom can I lean on, and for how long?
3. What am I owed, and when (by account, to the day) does it land?
4. What obligations hit in the next 30 / 60 / 90 days?
5. What is my worst-case runway if no new contracts land?
6. Which contracts are at risk, and what is the monetary exposure
   of each in gross and retained terms?
7. What is my accountant-adjusted tax bill versus the naive
   estimate, and what is the basis of the adjustment?

No field in any `/api/ai/*` response has ambiguous semantics across
account types, debt types, or tax types. `balanceSemantics`,
`debtKind`, `adjustmentBasis` are non-optional discriminators.
`/api/ai/manifest` is generated from the schema, not hand-written.

### 2.1 Financial Snapshot / Commitment Approval — initial slice ✅ SHIPPED

Single endpoint the agent calls before answering any spending
question.

**Shipped checklist**

- [x] **`GET /api/ai/financial-snapshot`** (`commitmentDays` query param; defaults aligned with other AI routes).
- [x] MCP **`bankstatements://ai/financial-snapshot`** + contract test vs `composeAiFinancialSnapshot`.
- [x] **`AiFinancialSnapshotResponseSchema`** on manifest **`contractSchemaExports`**; schema version **2.1.3**.
- [x] Composed **liquidity** (including **`liquidityCommitments`**) via `composeAiLiquidity`; **runway** via same forecast path as snapshot; **income** (outstanding invoices GBP + **`buildAggregateAccrualResponse`**); **discretionary**; **spendVsBudget** (dashboard-style nudges); **verdict** (`deriveFinancialVerdict` + unit tests).
- [x] **`GET /api/contracts/income-accrual`** thins to **`buildAggregateAccrualResponse`** in **`server/domain/contracts/aggregate-accrual.ts`**.

**Partially covered elsewhere:** the **Dashboard** + **`GET /api/ai/liquidity`** already expose **`liquidityCommitments`** (rolling **12-month** committed model, cash-after, significant lines) — see **§0.2**. §2.1 adds the **task-shaped** bundle on top (near-term window vs 12‑month block, runway headline, invoices + accrual rollup, nudges, verdict).

- Current liquid balance across accounts, per entity and global.
- Committed outgoings for next N days (from obligations + recurring
  detector).
- Accrued-but-not-yet-invoiced income (from 1.4) + outstanding
  invoices (from 1.3).
- Uncommitted / discretionary balance.
- Recent spending velocity vs budget.
- Verdict: safe / reduces runway to X / creates deficit in Y days.

Replaces the agent-side shape that `/api/dashboard/summary` can't
provide (the summary is UI-shaped and not task-shaped for
affordability questions).

**Deferred / nuance.** Near-term **`commitmentWindow.committedOutflowsGbp`** sums **AI pipeline obligation rows** only (see `discretionary.note` on the wire); full “obligations + recurring detector” parity for the window may be tightened later. **§2.2** (financial safety score) and **§2.3** (warnings metadata for agents) remain open.

### 2.2 Financial Safety Score (multi-factor; warnings = modifier, not base) — **NEXT**

**Goal.** One headline number (and explainability) for **“how safe am I financially?”** — aligned with how a principal **actually** thinks: *cash vs what I’m on the hook for*, *how long before stress*, *whether income will cover outflows*, not merely **“how few warnings fired today.”**

**Why the old framing was wrong.** Treating the score as **only** a reduction over §1.8 warnings makes **“fewer warnings ⇒ safer”** the main story. Warnings are **high-value tripwires** (missed filing, runway threshold, data gaps) but **secondary** to **structural affordability**: e.g. **£36k cash** with **~£180k committed over 12 months** (see **`liquidityCommitments`** on dashboard / **`GET /api/ai/liquidity`**) should drag the score down **even if** no new warning code exists yet.

**Design principles**

1. **Primary drivers = quantitative spine** already in the app: liquidity, rolling commitments, forecast runway, contract-accrual / expected receipts, income composition, debt-strategy headroom, spend context. The score **aggregates** these; it does not replace them.
2. **Warnings = modifier.** Active warnings **cap or subtract** from a **base score** derived from pillars (weighted `severity × urgency`), or define a **floor** (“never above 6/10 while critical overdue tax exists”). They must **not** be the only input.
3. **Reproducible.** Any consumer (UI, **`GET /api/ai/*`**, external LLM via MCP) can **recompute the same number** from the same **versioned formula id** + **published inputs snapshot** (see below). No hand-wavy prose as the source of truth.
4. **Structural life changes** (e.g. sell a house → more income / lower rent) move the score when **registry + transactions** move — same as today’s domain; the score reflects **updated model inputs**, not a separate magic state.

**Pillars (contributors — implement as weighted sub-scores with documented floors/caps)**

| Pillar | What it captures | Typical inputs (already or soon on MCP / AI routes) |
|--------|------------------|-----------------------------------------------------|
| **A — Liquidity vs commitments** | Cash vs rolling **spoken-for** outflows | `liquidityOverview.totalCashGbp` (or available), **`liquidityCommitments.totalCommittedGbp`**, **`cashAfterCommitmentsGbp`**; credit semantics from balance discriminators |
| **B — Runway / stress** | Time-to-negative under stress scenarios | **`runway.holisticGbp`**, **`financial-snapshot.verdict`**; optional mandatory-only variant |
| **C — Income durability & contract runway** | Will money keep arriving on pace? | **`financial-snapshot.income`** (accrual totals, outstanding invoices), **`pipeline`** expected-receipt rows, **contracts** end dates / renewal risk (encode as derived metrics), **§1.7 income composition** (concentration, active vs passive) |
| **D — Expense & debt load** | Fixed + debt drag vs headroom | **`debt-strategy`** state / headroom, **spend-context** (recurring + ad-hoc), budget nudges from snapshot |
| **E — Warnings modifier** | Explicit regime / data / obligation tripwires | **`GET /api/ai/warnings`** — severity, codes, urgency when §2.3 lands |

**Optional pillar F — Input quality / staleness.** When the ledger or key registries are stale or incomplete, **cap** the headline score (often overlaps §1.8 codes today; may later get explicit **“data health”** primitives on MCP so orchestrators need not infer from prose).

Weights and curves (e.g. logistic on **cash ÷ committed**, piecewise on **runway months**) are **product choices** — ship in one domain module + tests; **document in API** via `formulaVersion`.

**Wire shape (targets)**

- **`GET /api/ai/financial-safety`** (name TBD) returns:
  - **`score`** — e.g. 0–10 or 0–100 (single convention).
  - **`formulaVersion`** — string; bump when weights/curves change.
  - **`pillars[]`** — `{ id, label, contribution, rawMetrics: Record<…>, weight }` for UI + agents.
  - **`warningAdjustment`** — points deducted / cap applied + **warning ids or fingerprints** linked (after §2.3).
  - **`inputsRef`** — optional `generatedAt` alignment with **`financial-snapshot`** / **`liquidity`** so auditors see one consistent instant.

**MCP & external AI parity**

- **Manifest** lists the new response schema + guarantees the **input slices** used are already MCP resources: at minimum **`financial-snapshot`**, **`liquidity`**, **`runway`**, **`pipeline`**, **`income-composition`**, **`debt-strategy`**, **`spend-context`**, **`warnings`** (same JSON as HTTP).
- **Recomputation contract:** response includes **`formulaVersion`** + **pillar breakdown** with **numeric primitives** (not just labels) so an external model can **reproduce** the shipped score or **critique** it transparently.
- If the orchestrator prefers to **score offline**, it may **ignore** `score` and consume **`pillars[].rawMetrics`** only — still one canonical export of the contributing numbers.

**Acceptance.** Example: high cash **with** commitments ≫ cash → low pillar A → low headline score **without** requiring a bespoke “ratio warning.” Selling a house updates income/expense inputs → pillar C/D move when data is updated. Warnings-free but **catastrophic runway** still scores poorly via pillar B.

**Naming.** “Confidence” may stay as UI copy; roadmap uses **Financial Safety Score** to avoid implying “model self-confidence” rather than **user solvency / runway**.

### 2.3 Warnings metadata & agent ergonomics (for MCP / orchestrators)

**Replaces the old “Alert & Notification Queue” idea.** This repo does **not** own WhatsApp, email workers, or a `pending_alerts` delivery grid. **Channel delivery, cadence, and conversation** live in an **external orchestrator** (or equivalent) that calls **`GET /api/ai/warnings`**, **`GET /api/warnings/all`**, MCP **`bankstatements://ai/warnings`**, and existing **mutation** routes / future MCP tools.

**Problem solved.** Agents need more than `title` / `detail` / `recommended_action` strings. They need **stable identity** across runs, **machine-actionable links** into domain objects, **urgency / time-to-impact** surfaced consistently, and optional **user or orchestrator state** (snooze, ack, last surfaced) that does **not** pretend an unpaid HMRC liability has gone away just because a notification fired once.

**Design principles**

1. **Truth vs fatigue:** Persisted metadata must distinguish **(A)** “condition still true in domain data” (e.g. SA still overdue) from **(B)** “we already nudged the user” / “hide from UI until Tuesday.” **(A)** remains driven by §1.8 emitters; **(B)** is snooze / notify state.
2. **Chronic warnings:** Snooze hides or dampens **surfacing**, never **resolution**. Clearing the warning requires **domain resolution** (paid obligation, updated registry, *etc.*), same as today.
3. **Orchestrator-friendly:** Every warning should be **routeable** — which obligation, contract, invoice, debt, plan movement — without NLP on `detail`.

**Wire / schema shape (targets — implement incrementally)**

Extend **`EntityFoundationWarning`** / **`GET /api/ai/warnings`** (and keep UI parity) with fields such as:

| Area | Purpose |
|------|---------|
| **`fingerprint`** | Stable string per “logical” warning (e.g. hash of `code` + `entityId` + sorted stable `context` keys + linked ids). Survives **day-to-day `id` churn** so orchestrators can dedupe and track state. |
| **`firstSeenAt` / `lastActiveAt`** | When this logical warning first appeared / last appeared in a consolidated feed (optional; may derive from `warning_snapshots`). |
| **`urgency`** | Normalised **`critical` / `soon` / `overdue`** (or dates): `dueDate`, `daysOverdue`, `stressDate` — whichever applies; avoids agents parsing English. |
| **`links`** | Structured handles: `obligationId`, `contractId`, `invoiceId`, `debtId`, `planId`, `movementId` where applicable (nullable union), in addition to today’s `sources[]` strings. |
| **`actionHints`** | Small enum list or codes: e.g. `record_bank_payment`, `open_obligations`, `open_debt_strategy`, `reconcile_invoices` — maps to **existing APIs** or **future MCP tools** without embedding URLs. |
| **`userState`** (optional, persisted) | **`snoozedUntil`**, **`acknowledgedAt`**, maybe **`surface:dashboard|agent|both`** — user-scoped. Feeds respect snooze for **listing**; emitters still emit while condition holds unless product policy says otherwise. |
| **`orchestratorState`** (optional, persisted or delegated) | **`lastNotifiedAt`**, **`notifyCount`**, **`lastChannel`** — **either** stored here for audit **or** documented as **orchestrator-owned**; if stored, keyed by `fingerprint`. |

**Persistence**

- Prefer **`warning_user_state`** (or similar) keyed by **`fingerprint`** (+ account/user id if multi-user later).
- Reuse / complement **`warning_snapshots`** for `firstSeen` / diff lineage where it already helps.

**MCP / tools (later tranche)**

- **Read:** richer warnings resource (above fields) — no duplicate business logic.
- **Write (optional):** thin tools `warnings_snooze`, `warnings_ack`, `warnings_clear_snooze` calling the same persistence the UI would use.

**Out of scope (this repo)**

- WhatsApp / Meta / Twilio / email senders; cron workers that push messages; template selection for push notifications.

**Acceptance.** Orchestrator can prioritise and dedupe warnings from JSON alone; chronic tax / obligation warnings remain present until domain data fixes the underlying condition; snooze does not conflate with “paid HMRC.”

### ~~2.4 WhatsApp / Chat Interface~~ — **DEFERRED / EXTERNAL**

**Removed as an in-repo milestone.** Conversation and channel plumbing (WhatsApp, *etc.*) are expected to run in a **separate orchestration stack** that uses this application as the **source of truth** (HTTP + MCP). In-repo work focuses on **data**, **warnings**, **§2.3 metadata**, and **explicit mutations** — not chat transport.

---

## Tier 3 — Historical & Polish

### 3.1 Net Worth Tracking Over Time

Point-in-time balances exist; no historical snapshots.

- New `net_worth_snapshots` table (date, entity_id, total liquid,
  total obligations, total debt, net — per entity and global).
- Daily or weekly cadence.
- Trend context for the agent ("am I richer than 6 months ago?",
  "is the FZCO entity growing faster than UK Ltd?").

### 3.2 Multi-Currency / FX — extensions

Most of what this section used to cover (parsers, FX conversion,
per-invoice snapshot rates, entity-scoped currency handling) moves
into 1.1 (foundation) and 1.3 (invoicing). What remains in Tier 3:

- **Historical FX rate capture per transaction** — a full reconcilable
  FX audit trail (invoice snapshot + payment snapshot + transfer
  snapshot) for any cross-currency movement, not only invoice-related
  ones. Turns ad-hoc AED/GBP normalisation into an audit-grade
  historical ledger.
- **Multi-currency breakdown on all dashboard widgets** — once the
  entity toggle from 1.1 is shipped, most widgets show single-
  currency; this extension generalises native-currency display to
  every widget that currently implicitly renders in GBP.
- **Agent-facing cross-currency queries** — "how much have I spent in
  AED this month?", "what's the GBP-equivalent of FZCO's balance
  right now?".
- **UAE Economic Substance Regulations notification** — if FZCO's
  Relevant Activity classification turns out to trigger ESR, annual
  notification tracking becomes a tier-3 deadline type. Not in scope
  until the accountant confirms ESR applicability.
- **Historical La Fosse contract back-seeding** — the prior renewals
  that paid into Barclays in 2024 / early 2025 / 2025 should be
  back-seeded into `contracts.csv` so prior-year payment↔contract
  matching works retrospectively. Data-quality cleanup, not a
  functional change.

### 3.3 Historical Invoice Parser Fallbacks

- **OCR for scanned / image-only PDFs** — the FZCO Certificate of
  Formation PDF was image-only during roadmap authoring and could
  not be parsed via text extraction. Tesseract-via-`node-tesseract-
  ocr` or similar fallback kicks in when the primary text-
  extraction path yields empty output.
- **Automated inbound fetch from La Fosse's portal / email** — saves
  the weekly manual upload. Requires either an IMAP adaptor or a
  portal API integration.

### 3.4 Consolidate `transfer-patterns.ts` and `merchant-registry.ts` "Transfers" category

Two overlapping sources of truth for "this transaction is a
transfer, not real income/expense":

- `server/config/transfer-patterns.ts` — regex list
  (`TRANSFER_PATTERNS`, `isTransferLikeDescription`) used by
  `detectTransfers()` to gate whether same-account pairs can be
  matched, and by various repository queries as SQL `LIKE` patterns.
- `server/utils/merchant-registry.ts` + `server/utils/categorizer.ts`
  — the `Transfers` `CategoryName` with its own rule list used at
  render time to label transactions.

They share about 5-6 patterns (WISE, OPTIONAL FT, BUSINESS PREMIUM,
DRAW DOWN, named-person transfers). The semantics differ — one
suppresses classification, the other is a render label — so the
merge has to be deliberate rather than a mechanical dedup. Likely
shape: `merchant-registry` owns all pattern data, and
`transfer-patterns.ts` becomes a derived view over registry entries
where `category === 'Transfers'`. Deferred because the first attempt
showed genuine semantic differences around bounce detection
(`BOUNCE_PATTERNS` lives only in `transfer-patterns.ts` for now).

---

### 3.5 Automated Statement Ingestion (keep the parsers, kill the manual export)

**Problem.** Every bank statement in the system today is manually
exported from an online banking portal, saved to disk, and fed through
`server/parsers/*.ts` via the `/api/upload` route. That manual step is
the only reason transaction data lags behind reality. FreeAgent is
explicitly **not** an option: it is a downstream book of record, not a
feed provider, and its exports are post-categorisation accounting views,
not raw transaction truth (confirmed directly with FreeAgent —
[see transcript](e17fa411-9f76-418e-b41e-1425b9562fb9)). Under UK PSD2 /
Open Banking and UK GDPR Article 15/20 the account holder has a legal
right to machine-readable access to their own transaction data, so the
solution is to tap the upstream feed directly while preserving the
parser pipeline that already works.

**Guiding principle — parsers stay.** The existing
`server/parsers/{barclays,barclaycard,capital-on-tap,monzo,natwest,santander-everyday,emirates-islamic}.ts`
modules are the canonical transformers from raw bank payload ⇒ our
`transactions` shape. They are regression-locked, entity-aware, and
handle every edge case four years of real statements have thrown at
them. This feature **automates acquisition**, not parsing: a new
ingestion layer retrieves raw payloads on a schedule and hands them to
the existing parsers exactly as the upload route already does.

**Architecture — one ingester interface, many sources**

```text
┌────────────────────────────────────────────────────────────────────────┐
│  server/ingestion/                                                     │
│                                                                        │
│  sources/                       adapters that fetch raw payloads       │
│    gocardless-obi.ts            Open Banking (Barclays x3, NatWest,    │
│                                 Santander, Capital on Tap, Monzo)      │
│    monzo-direct.ts              Monzo native API (richer metadata)     │
│    email-attachment.ts          IMAP watcher for UAE statements        │
│    manual-upload.ts             existing /api/upload route (unchanged) │
│                                                                        │
│  normalizers/                   source-specific ⇒ parser-input shape   │
│    obi-to-csv.ts                Open Banking JSON ⇒ CSV rows the       │
│                                 existing parsers already accept        │
│                                                                        │
│  pipeline.ts                    orchestration:                         │
│                                   source → normalizer → existing       │
│                                   parser → existing dedup → transactions│
│                                                                        │
│  schedules.ts                   cron: daily per-account pull           │
└────────────────────────────────────────────────────────────────────────┘
```

The key insight is that **Open Banking JSON can be adapted to the same
shape CSVs already deliver** — date, description, amount, balance — so
the existing Zod-validated parser contracts don't need to change. Each
source adapter ends at the same seam: a buffer of rows in the canonical
parser-input shape, which is then handed to the account's configured
parser. The hash-based dedup in `server/db/repositories/transactions.ts`
already guarantees idempotency across sources, so parallel manual upload
+ automated pull is safe.

**Source selection per account**

| Account              | Primary source (automated)         | Fallback (manual) |
| -------------------- | ---------------------------------- | ----------------- |
| `barclays-current`   | GoCardless Bank Account Data (OBI) | CSV upload        |
| `barclays-savings`   | GoCardless Bank Account Data (OBI) | CSV upload        |
| `barclaycard`        | GoCardless Bank Account Data (OBI) | CSV upload        |
| `capital-on-tap`     | GoCardless Bank Account Data (OBI) | CSV upload        |
| `natwest`            | GoCardless Bank Account Data (OBI) | CSV upload        |
| `santander-everyday` | GoCardless Bank Account Data (OBI) | CSV upload        |
| `monzo-joint`        | Monzo Developer API (direct)       | CSV upload        |
| `emirates-islamic`   | IMAP email-attachment watcher      | PDF/CSV upload    |

**Why GoCardless Bank Account Data for the UK tier.** It is the only
FCA-authorised AISP aggregator with a genuinely free personal tier
(≥ 50 end-user connections / day, ample for nine accounts), covers every
UK institution in the table above, and permits self-use of one's own
data without the developer becoming a regulated party. TrueLayer is a
viable alternative but its free developer tier caps end-users at 5,
which is tight for this setup. Monzo is carved out as a direct source
because its native API returns richer metadata (merchant, counterparty,
scheme, settled vs authorised) than the Open Banking stream, and it
grants long-lived confidential-client credentials for self-use.

**Why IMAP for Emirates Islamic.** UAE Open Finance (CBUAE, launched
2024) does not yet have aggregator coverage for Emirates Islamic.
Statements arrive by email on a monthly cadence; an IMAP watcher that
filters by sender + subject, extracts the attachment, and feeds it into
the existing `emirates-islamic.ts` parser eliminates the manual step
without waiting for UAE open-finance rails to mature. Lean Technologies
/ Tarabut remain a future option if coverage expands.

**The 90-day re-consent problem (regulatory, unavoidable).** PSD2
requires end-user re-authentication every 90 days per account. The
ingestion pipeline must surface pending re-consents as a first-class
warning on the dashboard (feeding the 1.8 Warnings Engine) and as a
Deadlines row, so the re-consent cadence becomes a scheduled, visible
event rather than a silent failure. A "connection health" panel on the
accounts page shows last-pulled-at, next-reconsent-due, and token status
per account.

**One-off historical backfill via GDPR SAR.** Open Banking typically
only exposes the last ~24 months. To preserve full history going back
to 2014 (UK Ltd inception), a one-time GDPR Article 15 Subject Access
Request against each bank yields the full archive in machine-readable
form. This is a manual one-off, not an automated path, but it belongs in
the ingestion story because it's how the historical tail gets seeded.

**Schema additions**

```
transactions                                (existing)
  + source                                  (enum: manual | obi-gocardless |
                                             obi-monzo | imap | sar-backfill)
  + source_ref                              (external id from OBI / Monzo, used
                                             for cross-source dedup alongside
                                             the existing content hash)

account_connections                         (new)
  account_id                                FK to accounts
  source                                    enum as above
  provider_account_id                       e.g. GoCardless account uuid
  connected_at, last_pulled_at,
  reconsent_due_at, status
  credentials_ref                           opaque handle into a secrets store
                                            (never the raw token in SQLite)

ingestion_runs                              (new — observability)
  run_id, account_id, source,
  started_at, finished_at, status,
  rows_fetched, rows_inserted, rows_deduped,
  error_message
```

**Secrets handling.** OBI tokens, Monzo refresh tokens, and IMAP
credentials must not sit in SQLite alongside transaction data. Use an OS
keychain (macOS Keychain via `keytar`) for dev, and an env-var-injected
secrets path for any future deployment. SQLite stores only opaque
`credentials_ref` handles.

**Observability.** Every scheduled pull writes an `ingestion_runs` row
with row counts and diff metrics (new / deduped / conflicting). The
existing Deadlines / Warnings surfaces render these so a silent
ingestion failure (e.g. a connection expired without being renewed)
turns into an overdue warning within 24 hours.

**Test discipline.**

- Each source adapter has a recorded-fixture test: real payloads
  captured once, parsed offline forever, regression-locked.
- The pipeline end-to-end test seeds two sources for the same account
  (manual CSV + OBI) on overlapping date windows and asserts zero
  duplicates land in `transactions`.
- The re-consent expiry path has a clock-mocked test that asserts a
  Deadlines row appears 7 days before token expiry.

**Unblocked by 1.1.** The multi-entity foundation (§1.1, now shipped)
owns the authoritative `accounts → entityId` mapping this feature
depends on to route per-entity credentials. 3.5 can ship whenever
scheduled; it has no upstream dependency on the forecasting stack
(1.2 – 1.9).

---

### 3.6 Canonical Config Registry Pattern (architecture) ✅ SHIPPED

Every set-wise configuration lives at `server/domain/<name>/` with a standard layout (`schema.ts`, `data.ts`, `registry.ts`, `queries.ts`, `fixtures.ts`, `index.ts`, tests). Shared primitives in `server/domain/_shared/` plus a manifest-drift detector enforce that every registry index has a documented live consumer. Seven canonical registries migrated; `obligations` is the last exemption. Full pattern docs in [docs/config-registries.md](docs/config-registries.md). Every new registry (e.g. `leave`, `forecast`-adjacent helpers, future `income_sources`) plugs straight in.

---

## Dependency Chain

```
Tier 0 (Certainty) ✅       Tier 1 (Projection)                                                              Tier 2 (Agent)

Obligations + Deadlines     Multi-Entity Foundation (1.1) ✅
Multi-Entity Foundation ✅   Clients + Contracts (1.2 A–E) ✅─→ Working-Days Ledger (1.4) ✅┐
                            Invoicing §1.3 (incl. reconcile) ✅ ────────────────────────┤
                                                                                                                                     │
                                                                                                                                     ├─→ Forecast (1.5) ✅─┐
                                                                                                                                     │                  │
                                                                                                                                     ├─→ Warnings (1.8) ✅┤
                                                                                                                                     │                  ├─→ AI Primitives (2.0) ─→ Snapshot (2.1) ✅
                                                                                                                                     ├─→ Worst Case (1.6) ✅┤                        Financial safety (2.2)
                                                                                                                                     │                  │                          Warnings metadata (2.3)
                                                                                                                                     ├─→ Income Composition (1.7) ✅─┤              (channels → ext. orchestrator)
                                                                                                                                     │                  │
                                                                                                                                     └─→ Debt Strategy (1.9) ✅──┘
```

**Multi-Entity Foundation is the gate — and it is now open.** UK and UAE
books are separable at the query layer; every downstream Tier 1
feature inherits entity awareness via the `accounts` + `company`
registries and the jurisdiction-scoped `tax-rules.ts` module for
free.

**Clients + Contracts → Invoicing → Working-Days Ledger → Forecast →
Runway → Income Composition → Warnings → Debt Strategy** — **§1.1–§1.9** are
shipped. **§2.0.A–G** (AI primitives, slices, manifest, MCP) forms the base agent layer. **§2.0.H** is shipped (manifest + `/api/ai/*` + MCP for warnings, spend/expenses, income composition, debt strategy). **Tier 0 extension:** dashboard **`liquidityCommitments`** (12-month rolling projection) + AI/MCP parity — **§0.2**, **`AiLiquidityResponseSchema`**. **§2.1** Financial Snapshot — **`GET /api/ai/financial-snapshot`** / MCP + manifest **2.1.3** (see §2.1). **Next:** **§2.2** Financial Safety Score, then **§2.3** Warnings metadata (see build order below); **channels** stay outside this repo.

**The Warnings Engine (1.8)** remains the single severity-ranked spine for **explicit risk flags**. §2.2 **combines** that spine (as a **modifier**) with **liquidity, runway, and income** so “safe” is not defined by warning count alone. §2.3 adds **agent-facing metadata** on warnings (not a second engine).

**Structured Data for AI (2.0) gates all of Tier 2.** ~~Snapshot (2.1)~~ ✅ **shipped**;
Financial Safety Score (2.2) and Warnings metadata (2.3) depend on 2.0's semantic-drift cleanup (balance / debt /
tax discriminators), its core slice endpoints (`/api/ai/liquidity`,
`/api/ai/pipeline`, `/api/ai/runway`), the generated manifest, and
its thin MCP adaptor (2.0.G). **§2.0.H** is shipped: that surface now includes
**warnings, spend behaviour, income composition, debt strategy**, and
expenses manifest entries—still via composition,
not re-implemented math. No Open Close work starts before 2.0.A–G acceptance
criteria pass — the agent can only be as reliable as the primitives beneath
it, and it ships *as an MCP client* against this server rather than
re-implementing the glue.

---

## Suggested Build Order

**Steps 1–9** each map to a single **§1.1–§1.9** heading in order (no
more “step 6 = §1.8” skew between list index and section number).
**Tier 0 shell:** Dashboard vs Accounts + liquidity hero — **§0.2**.

1. ~~**Multi-Entity Foundation (1.1)**~~ ✅ SHIPPED — see §1.1.
2. ~~**Clients, Contracts & Renewals (1.2)**~~ ✅ SHIPPED — all five phases A–E (see §1.2).
3. ~~**Invoicing System (1.3) Phases 1–4**~~ ✅ SHIPPED — see §1.3.
4. ~~**Working-Days Ledger (1.4)**~~ ✅ SHIPPED — see §1.4.
5. ~~**Cash Flow Forecast (1.5)**~~ ✅ SHIPPED — `GET /api/forecast`; see §1.5.
6. ~~**Worst Case / Runway (1.6)**~~ ✅ SHIPPED — `GET /api/runway` + Strategy-tab holistic GBP hero (stress, accrual off) vs sandbox scenario (accrual on); Warnings thresholds; see §1.6.
7. ~~**Income Composition & Diversification (1.7)**~~ ✅ SHIPPED — `GET /api/income-composition`,
   three metrics with primitives, typed `riskSignals[]` discriminated union,
   per-property `leveraged-passive-income` signal, new `properties/` registry; see §1.7.
8. ~~**Solvency Warnings Engine (1.8)**~~ ✅ SHIPPED — unified tab + typed `context` + snapshot diff + `reserves/`; see §1.8.
9. ~~**Debt Strategy Advisor (1.9)**~~ ✅ SHIPPED — **Strategy** tab planner + sandbox, `plans.csv` / `movements.csv`, 12 warning codes; Budgets QoL/Malleable pills; see §1.9.
10. ~~**Structured Data for AI Consumption (2.0 A–G)**~~ ✅ SHIPPED (per repo): semantic
    discriminators, expected receipts, `GET /api/ai/{liquidity,pipeline,runway,snapshot,manifest}`,
    `GET /api/contracts/expected-receipts`, MCP resources over core slices.
11. ~~**Extended AI surface (2.0.H)**~~ ✅ SHIPPED — manifest 2.1.0 + `/api/ai/{warnings,income-composition,debt-strategy,spend-context}` +
    MCP resource parity; manifest rows for `/api/expenses/overview|recurring|ad-hoc`;
    `consolidated-feed` + shared expense read-builders; `vitest` + MCP contract + HTTP parity tests.
    **Follow-on (also shipped):** dashboard **`liquidityCommitments`** — rolling **12-month** committed outflows + cash-after model, mirrored on **`GET /api/ai/liquidity`** / MCP; **`LiquidityCommitmentsOverviewSchema`** on manifest; schema version **2.1.2** — see **§0.2**.
12. ~~**Financial Snapshot (2.1)**~~ ✅ SHIPPED (initial) — `GET /api/ai/financial-snapshot`, MCP `bankstatements://ai/financial-snapshot`, **`AiFinancialSnapshotResponseSchema`**, manifest **2.1.3**; see **§2.1**.
13. **NEXT — Financial Safety Score (2.2)** — multi-factor score (liquidity vs commitments, runway, income durability, expense/debt); §1.8 warnings as modifier; **`GET /api/ai/financial-safety`** + MCP + `formulaVersion` + pillar **`rawMetrics`** for external recomputation; see **§2.2**.
14. **Warnings metadata & agent ergonomics (2.3)** — stable `fingerprint`, structured `links`, `actionHints`, urgency fields, optional `userState` / `orchestratorState`; extends `GET /api/ai/warnings` / MCP; **no** in-repo message delivery; see **§2.3**.
15. **Net Worth Snapshots (3.1)** — entity-aware from day one.
16. **Multi-Currency extensions (3.2)** — whatever did not land in
    1.1 / 1.3.
17. **Historical Invoice Parser Fallbacks (3.3)** — OCR + inbound
    automation.
18. **(External)** Agent orchestration & notification channels — conversational stack (e.g. WhatsApp) consumes **`bankstatements://ai/*`** + REST; delivery not an in-repo milestone (~~§2.4~~).

---

## One-Line Summary

> You don't need more analytics — you need a system that **guarantees** no obligation
> can exist, be missed, or go unnoticed, past or future — and that surfaces **what cash is spoken for** on a rolling horizon, not just balances.
