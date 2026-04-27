# Feature Roadmap

> This app is not a finance tracker. It is a **threat elimination system for financial surprises**.
>
> Everything below is organized around one principle: closing the gap between "I can see what happened" and "nothing can surprise me."
>
> **What's shipped (Tier 0):** obligations registry, HMRC auto-seeders (VAT / CT / SA / TTP), **budgets** (monthly + yearly vs actual on the Dashboard, plus **nudges** for high-spend merchants that do not yet have a budget line), recurring detection, overdue hero, missed-obligation detector, multi-currency foundations (GBP + AED), and the Deadlines tab + calendar + ICS export.
>
> **What's shipped (Tier 1):** **Multi-Entity Foundation (1.1)**, **Clients, Contracts & Renewals (1.2)** phases A–E, **Invoicing (1.3)** Phases 1–4 (incl. payment reconciler with FX), **Working-Days Ledger (1.4)** with public holidays + leave calendar, **Cash Flow Forecast (1.5)** at `GET /api/forecast`, **Worst Case / Runway (1.6)** at `GET /api/runway` (household-first, GBP + AED dual headline, entity drill-down, credit headroom per currency), and **Income Composition & Diversification (1.7)** at `GET /api/income-composition` (three single-mode-risk metrics with primitives, typed `riskSignals[]` discriminated union, per-property `leveraged-passive-income` signal, new `properties/` registry).
>
> **What's next (Tier 1 → Tier 2):** Tier 1 (§1.1 – §1.9) is shipped. Next: **§2.0** structured-data endpoints for AI consumption (semantic discriminators, expected-receipts calendar, slice endpoints), then the rest of Tier 2 (snapshot, confidence score, alert queue, WhatsApp tool surface). Context unchanged: two entities (UK Ltd + UAE FZCO), agency and direct clients, mixed self-bill and supplier-issued mechanisms.

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
- **B — Templates + recipient routing.** Pure `renderTemplate` + `resolveRecipients` over `.hbs` files (`leave`, `sickness`, `invoice-cover`, `renewal`); per-client overrides; structured errors. Consumed today by 1.2.E leave preview, by 2.3 for send.
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
- **DRY engine:** shared `assembleForecastEvents` is reused by `/api/forecast` and `/api/runway`; bills/QoL rule lives once in `shared/expenses-insight.ts`.
- **API only today.** No standalone runway page in this phase. **Primary UI surface: the §1.8 Warnings tab** — runway-threshold breaches and "trapped cash" insights are emitted as warnings (see §1.8 catalog) so they sit next to tax, contract, and spend warnings on a single ranked surface rather than living in a tab the user has to remember to open. A focused runway dashboard panel can follow once §1.8 ships if the warning summary isn't enough on its own.

### 1.7 Income Composition & Diversification ✅ SHIPPED

`GET /api/income-composition` — three single-mode-risk metrics + typed risk signals, composed read-only over existing registries.

- **Income at face value.** Joins contracts + rental obligations + recurring-pipeline detected income (deduped) into a uniform `IncomeSource` list. Rental income is gross; mortgage + insurance stay in mandatory outgoings (no netting on either side, symmetric).
- **Three metrics, primitives travel with each.** `clientConcentration`, `activePassiveRatio`, `timeIndependence` — every metric exposes its numerator and denominator so consumers compose their own caveats. Per currency household + per-`(entityId, currency)` drill-down. No GBP+AED blend.
- **`riskSignals[]` typed discriminated union** — each variant inlines primitives next to `code` and `severity`, no baked prose. Codes: `client-concentration-{extreme,elevated}`, `time-independence-{low,elevated}` (with `additionalPassiveNeeded` / `mandatoryReductionNeeded` math), `mode-concentration-extreme`, `passive-income-zero`, plus `leveraged-passive-income` per property (`grossMonthly`, `mortgageMonthly`, `netMonthly`, `netToGrossRatio` — surfaces leverage as a signal without fudging income).
- **New canonical `properties/` registry** owns the rent ↔ mortgage join via `property_id`. Three seed rows; nullable `property_id` column added to `obligations.csv`; rental-income rows must reference one. Cross-registry FK integrity test locks it.
- **`server/domain/income-composition/`** is a service module (not a registry — same shape as `forecast/`); listed in `NON_REGISTRY_DIRS`.
- §1.8 will lift `riskSignals[]` directly onto the warnings tab; existing `EntityFoundationWarning` strings stay untouched here and harmonise additively when 1.8 ships.

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
- The warning schema remains the spine for §2.2 Confidence Score
  and §2.3 Alert Queue.
- **Leveraged-passive-income hardened (post-ship fix):**
  - `match_amounts[0]` is the canonical "current contractual monthly
    payment" on every debt; subsequent entries are alternative values
    the matcher should still recognise. Active debts must list at
    least one positive value (load-time gate).
  - New optional `match_tolerance_pct` column lets a debt opt into a
    fuzzy band (e.g. Bounce Back Loan at ±2.5% absorbs natural
    interest-on-declining-balance drift without manual CSV edits).
  - `buildPropertyLeverageInputs` now reads `debt.matchAmounts[0]`
    directly per property, replacing the old "sum the recurring
    pipeline by `merchant_pattern`" approach that blended Hunters and
    Thorney mortgages (same NatWest pattern) into a single fictitious
    £1,687/mo. Two regression tests lock the per-property correctness
    + the no-summing invariant.

### 1.9 Debt Strategy Advisor — **SHIPPED**

A money-plumbing assistant. The user picks a goal (clear a debt, save
for a target) and the planner returns a realistic, feasibility-checked
plan: which standing orders to set up, from which account to which, on
what day of the month, with what projected clear date. The user copies
it into their bank app and forgets about it. The §1.8 warnings spine
keeps them honest. Composes §1.5 forecast + §1.6 runway + §1.7 income
composition + §1.8 warnings spine + the existing budgets system into a
coherent goal-driven layer.

**Behavioural contract.** QoL budgets are inviolable; malleable
budgets are user-adjustable in the activation UI; no silent recompute
on background data changes (only feasibility warnings); refinancing
trade-offs always show all three plans (keep-as-is, min-only,
overpay); multi-plan allocation is sequential first-come-first-served;
suggested plans are ephemeral (route-only) — only activated plans
persist.

**Data model.**

- `debt-strategy/plans.csv` — canonical registry. Goal type
  (`pay-off-debt` | `save-for-target`), target id / amount, scope,
  currency, intensity, monthly_allocation, status (`active` | `paused`
  | `completed` only — `suggested` is route-only and never persists).
- `debt-strategy/movements.csv` — sibling CSV; one row per standing
  order. FK on `plan_id`. Multiple movements per plan supported.
  Canonical `acknowledged_at` and `dismissed_missed_until` survive
  DB rebuilds; `status` and `last_detected_match_date` are derived.
- `CategoryConfig.qol?` — extension to `server/utils/categorizer.ts`.
  Seeded: Groceries / Childcare & Education / Health & Personal are
  QoL; Eating Out / Transport / Shopping / Entertainment / Accommodation
  / Travel / Other / Business are malleable. Mandatory categories
  (`budgetable: false`) omit the field.
- `AccountConfig.creditCard?` — optional block on credit-card
  accounts: `{ standardApr, promo?: { apr, expiresAt, transferFeePct,
  minPaymentPct, minPaymentTerminatesPromo } }`. The seed's three
  credit-card accounts launch `creditCard: undefined`; the planner
  refuses to model refinance moves until populated, surfaced via the
  `account-credit-card-config-missing` warning.

**Pure planner modules (`server/domain/debt-strategy/`).**

- `compute-headroom.ts` — `income − mandatory − Σ(category budgets)`.
- `available-headroom.ts` — `total − Σ(active plans, same currency+scope)`.
- `present-intensity-options.ts` — Aggressive 95% / Medium 50% /
  Passive min(£100, 15%); stretches to honour fixed-date deadline
  minimums; `feasible: false` when even Aggressive can't hit it.
- `generate-plan.ts` — composes the above; returns block reasons
  (`plan-blocked-fzco-no-savings-account`, `plan-blocked-incomplete-budgets`,
  `plan-infeasible`).
- `check-plan-feasibility.ts` — `ok` / `degraded` (≤25% gap) /
  `infeasible` (>25% gap); returns typed `suggestedRemedies` (switch
  intensity, pause other plan, extend deadline, reduce target).
- `evaluate-refinance-tradeoff.ts` — always returns ALL three plans
  (`planA_keepAsIs`, `planB_minOnly`, `planB_overpay`) plus
  `promoExpiresMidPayoff` flag and `postIntroJumpToRate`.
- `detect-target-reached.ts` — pay-off via `getDebtSummary.currentBalance
  ≤ 0` (catches balloon payments naturally); save via net inflow vs
  `target_amount`. Auto-completion gate.
- `auto-suggest-plans.ts` — emits one ephemeral `suggested` plan per
  active consumer debt without an active plan, sorted by avalanche
  (highest APR first); default intensity `medium`.
- `assemble.ts` — `assembleDebtStrategy()` orchestrator. Single I/O
  entrypoint shared by the route + the warning emitters.

**Warning emitters (wired into `/api/warnings`).** 12 new codes:
`account-credit-card-config-missing`, `plan-blocked-incomplete-budgets`,
`plan-blocked-fzco-no-savings-account`, `mortgage-rate-reset-soon`,
`debt-unregistered`, `plan-feasibility-degraded`, `plan-budget-blown`,
`plan-transfer-not-set-up`, `plan-transfer-missed`,
`plan-standing-order-can-be-stopped`, `plan-infeasible`,
`plan-target-reached`. All carry typed `context` primitives so the AI
layer (Tier 2) can render bespoke prose without re-deriving the math.
All auto-clear via the existing §1.8 snapshot diff.

**Money-movement match rules (strict).** Reuses
`doAmountsAndDatesMatch` ([`server/domain/inter-company/pair-finder.ts`](server/domain/inter-company/pair-finder.ts))
with stricter constants: `±3 day` tolerance, exact amount (within
£0.01). User-dismissed warnings record
`dismissed_missed_until = now + 30d` to silence the next emission.

**API.** `GET /api/debt-strategy/state`, `POST /plans`,
`POST /plans/:id/activate-suggested`,
`POST /plans/:id/movements/:movementId/acknowledge`,
`POST /plans/:id/movements/:movementId/dismiss-missed`,
`POST /plans/:id/pause | /resume`, `DELETE /plans/:id`,
`POST /sandbox` (what-if read).

**UI.** New Strategy section under the existing Debts tab. Suggested-
plans panel (always present, auto-derived). Active-plans panel with
inline movement acknowledgements + pause/resume/delete. Completed
plans archive. "What if?" sandbox button. Budgets tab gains a small
read-only QoL/Malleable pill next to each budgetable category
(reads from `categorizer.ts`; not editable from UI in v1 — code
change required).

**Lost-contract regression test** (`server/domain/debt-strategy/lost-contract.test.ts`)
locks the killer use case: active plan goes from `ok` → `degraded` /
`infeasible` when income drops; emitter produces actionable
`suggestedRemedies` primitives.

**Out of scope (deferred, no further §1.9 work).** Open Banking
initiated transfers (forever); auto-derived budget defaults; cross-
plan optimisation beyond first-come-first-served; FZCO save-for-target
plans (needs an AED savings account first); editing QoL/Malleable
tags from the UI; plan state-change audit log.

---

## Tier 2 — AI Agent Layer ("Proactive Guardian")

### 2.0 Structured Data for AI Consumption (agent prerequisite)

Before Open Close (2.3 + 2.4) or any external AI assistant
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

**Gate.** Blocks 2.1, 2.2, 2.3, 2.4. No Open Close work should start
until 2.0 acceptance criteria pass.

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

- `GET /api/ai/liquidity` — per-entity and global: `cash`,
  `creditRemaining`, `debtOwed`, `earmarkedForTax`. Reduces over
  2.0.A balances + existing tax-reserve fields from 1.2.E.
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
- Any future agent — including Open Close (2.3/2.4) — becomes an MCP
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
generated manifest exist. It closes out 2.0.

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

### 2.1 Financial Snapshot / Commitment Approval

Single endpoint the agent calls before answering any spending
question.

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

### 2.2 Confidence Score (reduction over the Warnings Engine)

A daily psychological stabiliser: a single number that answers "am I
safe?"

No longer an independent calculation — it is a weighted reduction
over the Solvency Warnings Engine (1.8) output. A warning-free state
is 10 / 10; each active warning deducts based on `severity ×
time-to-impact`. The score can never lie about its reasoning because
the list that drives it is always clickable and specific.

- Financial Safety: 8.5 / 10.
- Unknown Risk: Low / Medium / High, derived from data-staleness
  warnings specifically.
- Inputs flow through 1.8, not directly:
  - Missed-obligation signal (existing overdue hero +
    auto-matcher).
  - Forecast health (from 1.5).
  - Invoice-to-working-days discrepancies (from 1.3 + 1.4).
  - Budget adherence (from existing budgets).
  - Income composition — client concentration, active/passive
    ratio, time-independence ratio, and income-goal progress (from
    1.7).
  - Scheduled-leave shortfall (from 1.4).
  - Multi-entity specific — FZCO CT unknown, UAE thresholds,
    inter-company movements, `TBC` fields (from 1.1 + 1.2).
- Score drop → the warning(s) that moved it are surfaced verbatim;
  the agent has the list without re-deriving.

### 2.3 Alert & Notification Queue (delivery path for the Warnings Engine)

The schema of *what to alert about* lives in 1.8. 2.3 is purely
delivery: take an emitted warning and get it to the right channel at
the severity-appropriate time.

- New `pending_alerts` CSV/table
  (`alert_id, warning_id, channel, severity, scheduled_for,
  delivery_status, delivered_at`).
- Trigger rule: any warning with `severity ≥ threshold` and
  `scheduled_for <= now` is queued for delivery.
- Delivery adaptors: WhatsApp API, email.
- Warning resolution (state changes that clear the trigger condition)
  auto-cancels any pending alert for that warning so you are never
  pinged about something you have already fixed.

### 2.4 WhatsApp / Chat Interface

Delivery channel, not logic. Wraps 2.1 + 2.2 + 2.3 in conversation.
Ship last — the agent is only as good as the layers underneath it.

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
                                                                                                                                     ├─→ Warnings (1.8) ─┤
                                                                                                                                     │                  ├─→ AI Primitives (2.0) ─→ Snapshot (2.1)
                                                                                                                                     ├─→ Worst Case (1.6) ✅┤                        Confidence Score (2.2)
                                                                                                                                     │                  │                          Alert Queue (2.3)
                                                                                                                                     ├─→ Income Composition (1.7) ✅─┤              WhatsApp (2.4)
                                                                                                                                     │                  │
                                                                                                                                     └─→ Debt Strategy (1.9) ───────┘
```

**Multi-Entity Foundation is the gate — and it is now open.** UK and UAE
books are separable at the query layer; every downstream Tier 1
feature inherits entity awareness via the `accounts` + `company`
registries and the jurisdiction-scoped `tax-rules.ts` module for
free.

**Clients + Contracts → Invoicing → Working-Days Ledger → Forecast →
Runway → Income Composition → Warnings** is the main income-side backbone —
**1.1–1.7** are shipped. **Next on this stack:** **1.8** (unified Warnings tab +
multi-source severity), which lifts 1.7's `riskSignals[]` directly onto the tab
and harmonises the existing `EntityFoundationWarning` shape into the same
primitive-carrying form.

**The Warnings Engine (1.8) gates most of Tier 2.** Both the
Confidence Score and the Alert Queue become reductions over its
output, not independent calculations, so there is exactly one place
where "is this user safe?" is decided.

**Structured Data for AI (2.0) gates all of Tier 2.** Snapshot (2.1),
Confidence Score (2.2), Alerts (2.3) and the WhatsApp / Chat interface
(2.4) all depend on 2.0's semantic-drift cleanup (balance / debt /
tax discriminators), its slice endpoints (`/api/ai/liquidity`,
`/api/ai/pipeline`, `/api/ai/runway`), the generated manifest, and
its thin MCP adaptor (2.0.G) that exposes the same slices to any
MCP-aware client (Cursor, Claude Desktop, ChatGPT-via-bridge, Open
Close). No Open Close work starts before 2.0's acceptance criteria
pass — the agent can only be as reliable as the primitives beneath
it, and it ships *as an MCP client* against this server rather than
re-implementing the glue.

---

## Suggested Build Order

**Steps 1–9** each map to a single **§1.1–§1.9** heading in order (no
more “step 6 = §1.8” skew between list index and section number).

1. ~~**Multi-Entity Foundation (1.1)**~~ ✅ SHIPPED — see §1.1.
2. ~~**Clients, Contracts & Renewals (1.2)**~~ ✅ SHIPPED — all five phases A–E (see §1.2).
3. ~~**Invoicing System (1.3) Phases 1–4**~~ ✅ SHIPPED — see §1.3.
4. ~~**Working-Days Ledger (1.4)**~~ ✅ SHIPPED — see §1.4.
5. ~~**Cash Flow Forecast (1.5)**~~ ✅ SHIPPED — `GET /api/forecast`; see §1.5.
6. ~~**Worst Case / Runway (1.6)**~~ ✅ SHIPPED — `GET /api/runway`, household-first GBP/AED dual headline + entity drill-down; see §1.6.
7. ~~**Income Composition & Diversification (1.7)**~~ ✅ SHIPPED — `GET /api/income-composition`,
   three metrics with primitives, typed `riskSignals[]` discriminated union,
   per-property `leveraged-passive-income` signal, new `properties/` registry; see §1.7.
8. ~~**Solvency Warnings Engine (1.8)**~~ ✅ SHIPPED — Warnings tab is now the
   consolidated, severity-sorted spine: §1.1 entity-foundation + §1.6 runway
   thresholds + §1.7 risk signals + tax-reserve + ad-hoc-spend escalation
   all served by `GET /api/warnings/entity-foundation` (alias `/api/warnings/all`),
   each warning carries typed `context` primitives, snapshot-diff emits
   `warning-improved` / `warning-cleared`. New `reserves/` registry replaces
   `showTaxLiabilities`. Frontend: entity filter + optional source-group toggle.
9. ~~**Debt Strategy Advisor (1.9)**~~ ✅ SHIPPED — money-plumbing assistant.
   Goal-driven planner (clear a debt / save for a target) with three intensity
   options, sequential first-come-first-served allocation, refinance trade-offs
   that always show all three plans, auto-suggested plans for uncovered consumer
   debts (avalanche order), strict ±3-day movement matching, auto-completion
   gate, "what if?" sandbox. New `debt-strategy/plans.csv` + `movements.csv`
   registries. 12 new §1.8 warning codes wired into `/api/warnings`. UI under
   the existing Debts tab + QoL/Malleable pill on the Budgets tab. Killer
   use case (lost contract → degraded plan with actionable remedies) locked
   by integration test. See §1.9.
10. **Structured Data for AI Consumption (2.0)** — prerequisite to
    all of Tier 2: semantic discriminators, expected-receipts
    calendar, slice endpoints (`/api/ai/liquidity`,
    `/api/ai/pipeline`, `/api/ai/runway`), snapshot composer +
    `/api/ai/manifest`, and a thin MCP server exposing the same
    slices as Resources + Tools with both stdio + HTTP+SSE
    transports. Gates Open Close.
11. **Financial Snapshot (2.1)** + **Confidence Score (2.2)** —
    the agent's two core reads; both consume 2.0's slices.
12. **Alert & Notification Queue (2.3)** — delivery path for 1.8.
13. **Net Worth Snapshots (3.1)** — entity-aware from day one.
14. **Multi-Currency extensions (3.2)** — whatever did not land in
    1.1 / 1.3.
15. **Historical Invoice Parser Fallbacks (3.3)** — OCR + inbound
    automation.
16. **WhatsApp / Chat Interface (2.4)** — delivery channel, ships
    last.

---

## One-Line Summary

> You don't need more analytics — you need a system that **guarantees** no obligation
> can exist, be missed, or go unnoticed, past or future.
