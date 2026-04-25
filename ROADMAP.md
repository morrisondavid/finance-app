# Feature Roadmap

> This app is not a finance tracker. It is a **threat elimination system for financial surprises**.
>
> Everything below is organized around one principle: closing the gap between "I can see what happened" and "nothing can surprise me."
>
> **What's shipped (Tier 0):** obligations registry, HMRC auto-seeders (VAT / CT / SA / TTP), **budgets** (monthly + yearly vs actual on the Dashboard, plus **nudges** for high-spend merchants that do not yet have a budget line), recurring detection, overdue hero, missed-obligation detector, multi-currency foundations (GBP + AED), and the Deadlines tab + calendar + ICS export.
>
> **What's shipped (Tier 1):** **Multi-Entity Foundation (1.1)**, **Clients, Contracts & Renewals (1.2)** phases A–E, **Invoicing (1.3)** Phases 1–4 (incl. payment reconciler with FX), **Working-Days Ledger (1.4)** with public holidays + leave calendar, **Cash Flow Forecast (1.5)** at `GET /api/forecast`, and **Worst Case / Runway (1.6)** at `GET /api/runway` (household-first, GBP + AED dual headline, entity drill-down, credit headroom per currency).
>
> **What's next (Tier 1):** **1.7** income diversification, **1.8** warnings engine — **unified tab** with multi-source items (incl. **escalating unbudgeted ad-hoc / discretionary spend** surfaced from the same signals as Dashboard nudges, with traffic-light severity), **1.9** debt advisor, and Tier 2 (agent / notifications). Context unchanged: two entities (UK Ltd + UAE FZCO), agency and direct clients, mixed self-bill and supplier-issued mechanisms.

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

### 1.7 Income Composition & Diversification

**Same problem statement.** The sharper concern isn't "single client risk", it's **single-mode risk** — *all* current income across every active stream stops the moment active work stops. Measuring that needs every income stream classified.

**Reuses existing data — no new income CSV.** Income already lives in four places: [`clients/contracts.csv`](clients/contracts.csv) (consulting), [`obligations/obligations.csv`](obligations/obligations.csv) under `category: 'rental-income'` (per-property gross), [`debts/debts.csv`](debts/debts.csv) for matching mortgages (already carries `property_id`), and the recurring-income detector for salary / dividends / ad-hoc inflows. 1.7 composes a single read-only `IncomeSource` surface over them — no parallel CSV, no `income_sources.csv`.

**Income at face value, expenses where they already live.** Rental income is the obligation row's gross `amount` — no mortgage netting, no insurance netting. The mortgage and insurance live in obligations / the recurring pipeline as outgoings, where they already do. `mandatory_monthly_outgoings` is `Σ(items where isMandatoryCategory(item.category))` — full sum, no exclusion logic. Symmetric, simple, accurate to source.

**Two new domain folders.** `server/domain/properties/` is a canonical registry on the §3.6 pattern. `server/domain/income-composition/` is a **service module** on the §1.6 `forecast/` shape (listed in `NON_REGISTRY_DIRS`) — pure functions over the upstream registries, no CSV.

- **`server/domain/properties/`** — `properties/properties.csv` with three seed rows (`hunters-square-78`, `thorney-house-56`, `heath-park-road-53` — the third is the home today; flips to rental in future via an obligation row, no schema change). Replaces today's `display_name`-string match between rental-income obligations, landlord-insurance obligations, and mortgage debts. Adds a nullable `property_id` column to `obligations.csv`; backfills the four existing property-related rows.

- **`server/domain/income-composition/`** — `activity-class.ts`, `aggregator.ts`, `metrics.ts`, `risk-signals.ts`, `index.ts`, tests. Surfaces:
  - `INCOME_ACTIVITY_CLASS`: `passive | semi-passive | active` keyed on income kind (in code, not CSV).
  - `listAllIncomeSources()` — joins contracts + rental obligations + recurring-pipeline detected income, with **dedupe** (no double-counting UK Ltd salary that's already a contract). Tags each with `activity_class`.
  - `computeIncomeComposition()` — emits the three metrics below per entity and household (per currency, no GBP+AED blend). Reuses `isMandatoryCategory` from [`shared/expenses-insight.ts`](shared/expenses-insight.ts) (shipped in 1.6).
  - `computeRiskSignals()` — emits typed signals for §1.8.
  - One endpoint `GET /api/income-composition`.

**Three metrics — each carries its primitives, not just a ratio.**

1. **Client concentration** — `max(client_monthly_income) / total_active_income`. Response includes `topClientId`, `topClientMonthly`, `totalActiveMonthly`. *"If one client drops me, how much active income do I lose?"*
2. **Active / passive ratio** — `(passive monthly) / (total monthly)`, with `passiveByKind` split. Structural mix metric. Response includes `passiveMonthly`, `activeMonthly`, `totalMonthly`.
3. **Time-independence ratio** — `(passive monthly) / mandatory_monthly_outgoings`. The resilience metric. Response includes `passiveMonthly`, `mandatoryMonthly`. With mortgage in mandatory outgoings (where it already lives) and rent gross on the income side, this answers *"if active income stopped, what fraction of my real bills could passive income cover?"*

**Risk signals — typed primitives, not baked prose.** `riskSignals[]` is a Zod discriminated union by `code`; each variant inlines its own data fields next to `code` and `severity` (same convention as `IncomingObligationSchema`). No `detail` or `recommended_action` strings — consumers compose any prose they need from the data. Codes: `client-concentration-extreme/elevated`, `time-independence-low/elevated`, `mode-concentration-extreme`, `passive-income-zero`, plus `leveraged-passive-income` (per property, fired when `mortgageMonthly / grossMonthly` is high — the leverage truth surfaced as a signal rather than fudged into the income side). Each signal carries every primitive a §1.8 warning row needs (numerator, denominator, threshold, ratio, plus context fields like `topClientId` or `propertyId`).

**Optional later:** nullable `activity_class_override` column on `contracts.csv` for the rare retainer-shaped contract that isn't really `active`. Defer until one exists; today every contract is `active` by category.

**Emits into §1.8.** §1.8's warning rows become thin renderers over `riskSignals[]` — the warnings tab calls a formatting helper that turns each typed signal into a card. Existing `EntityFoundationWarning` strings stay untouched in 1.7; §1.8 is the right place to harmonise the older string-baked warnings to the same primitive-carrying shape additively. No `income_goals.csv`, no goal-progression warnings — aspirational MRR / FIRE tracking is a separate concept and out of scope for 1.7.

### 1.8 Solvency Warnings Engine (the Warnings tab)

**One list, many sources — traffic-light, not a silo per domain.** The
Warnings tab is a **unified, ranked** feed: tax, contracts, invoices,
data quality, income diversification, **and** discretionary spend
signals all map into the **same** `{ severity, title, detail,
recommended_action, sources[] }` shape, filterable by entity. The user
sees a **single** severity-sorted surface (red / amber / green-style
semantics on `severity`), not separate pages that never talk to each
other.

**Forward-looking, ranked, specific, unprompted.** The app's single
most important output once the forecast exists. Where the Overdue Hero
surfaces *past-tense* misses, the Warnings Engine surfaces
*future-tense* structural problems *and* material **ongoing** leaks
(see unbudgeted ad-hoc spend below):

> "Barclays Savings holds £2,500. UK VAT £10k is due in 60 days from
> that account. Current monthly net saving = £X. At this trajectory
> you will be £Y short on the due date."
>
> "UK CT £50k due in 9 months. To cover it you need to set aside
> £5,555/month starting now. You are currently saving £1,200/month.
> Shortfall: £4,355/month."
>
> "FZCO UAE CT registration status unknown. First FZCO invoice
> received; liability unquantifiable until QFZP election recorded
> on `company.csv`. Consult accountant."

**Partially shipped today → 1.8 bridge (ad-hoc / discretionary).** The
**Dashboard** already shows monthly vs actual budgets and a
**"High-spend merchants without a budget"** nudge strip (derived from
transaction history — merchants you spend a lot on that have no budget
row yet; deep-link to add a budget or open Ad hoc analysis). **Gap for
1.8:** nudges are **local to the Dashboard**; they are not part of the
**Warnings** spine, have no **cross-domain rank** next to "VAT due in 60
days", and do not **escalate** when the user *chooses* not to add a
budget (e.g. high Careem or delivery spend in Dubai as a conscious
convenience trade — still a **material** monthly line that should
surface as amber/red when it crosses rolling thresholds, share of
discretionary spend, or month-on-month velocity). **1.8 work:** feed the
same underlying merchant/category aggregates into the warnings pipeline;
define severity and dedupe so "high unbudgeted merchant" appears once,
with a clear `recommended_action` (set a cap, reclassify, or
acknowledge).

Formalises earmarking intent (currently only implicit in the user's
head):

- New per-obligation-type `reservoir_account` config (UK VAT →
  barclays-savings; UK CT → barclays-savings; UK SA → …; UAE VAT →
  emirates-islamic; UAE CT → emirates-islamic). Per-entity, not
  global. Replaces today's `showTaxLiabilities` display flag with a
  real policy.
- Warning catalog — each warning emits
  `{id, severity, title, detail, recommended_action, sources[]}`:
  - Tax reservoir underfunded (balance vs sum of upcoming tax due
    within window).
  - Tax reservoir trajectory missing (balance + projected
    contributions < liability by due date).
  - Non-tax obligation unaffordable.
  - Contract ending, no successor (from 1.2).
  - Payment from known payer outside any active contract window
    (from 1.2 matcher).
  - Self-bill PDF expected for period N (weekly cadence) not
    received (from 1.3).
  - FX drift on unpaid invoice > 5% (from 1.3).
  - Scheduled-leave income shortfall (from 1.4).
  - Client concentration risk (from 1.7).
  - Active/passive ratio deterioration (from 1.7).
  - Time-independence ratio regression (from 1.7).
  - Income-goal progress / completion (from 1.7) — both shortfall
    and positive completion at severity `info`.
  - Burn rate exceeds income (rolling 30d).
  - **Runway under threshold (from 1.6)** — household runway in
    either headline currency (GBP / AED) drops below configurable
    bands (e.g. red < 3 months, amber < 6 months) on the *full
    lifestyle* lane. `detail` cites the first stress date,
    contributing recurring lines, and the GBP/AED split so the user
    can see *which* currency is the constraint. Reads
    `/api/runway`'s `household.{GBP,AED}.runwayMonthsFullRecurring`
    and `firstStressDateFullRecurring`.
  - **Mandatory-only runway under threshold (from 1.6)** — same
    rule against `runwayMonthsMandatoryRecurring`, severity capped
    higher (running out on **bills only** is materially worse than
    running out at full lifestyle). `recommended_action` points to
    the bills/QoL split so the obvious "what can I cut?" question
    is one click away.
  - **Trapped cash / inter-company constraint (from 1.6)** — one
    currency bucket is solvent through horizon while the other goes
    negative first (e.g. AED healthy, GBP runs out in N weeks).
    Surfaces as a narrative warning that *moving money* is the
    constraint, not earning more — actionable only because §1.6
    refuses to silently blend GBP and AED into a single number.
  - **Unbudgeted ad-hoc / discretionary spend (merchant- or
    pattern-level)** — sustained spend on a merchant or MCC **without**
    a matching budget line, breaching materiality rules (e.g. rolling
    30/90d total, % of net income, or sharp MoM increase). Catches
    "I know it’s expensive but I haven’t time to plan groceries /
    transport" **before** it silently dominates cash outflow. Sourced
    from the same building blocks as Tier 0 dashboard nudges, ranked
    alongside tax and contract warnings.
  - Credit utilisation high.
  - Data staleness (no statement for account X in N weeks).
  - **Multi-entity specific (new):**
    - FZCO UAE CT registration status unknown.
    - FZCO UAE VAT voluntary threshold crossed (AED 187.5k).
    - FZCO UAE VAT mandatory threshold crossed (AED 375k).
    - IFZA license renewal within 60 days (annual).
    - Inter-company money movement unclassified (loan / capital /
      service fee).
    - `autonize-it/company.csv` / `clients.csv` /  `contracts.csv`
      has any unresolved `TBC` field.
- Dedicated **Warnings tab** UI renders the list ranked by
  `severity × time-to-impact`, filterable by entity.
- The warning schema is the spine for the Alert Queue (2.3) and the
  Confidence Score (2.2) — both become reductions over this list, not
  independent calculations.

### 1.9 Debt Strategy Advisor

The debt data model is already rich (`interestRate`,
`fixedRateEndDate`, `repaymentType`, `kind` on every row). What is
missing is the rule set that turns it into recommended actions.
Rule-based, deterministic, testable — no LLM required:

- **Avalanche** (highest APR first) and **snowball** (smallest
  balance first) payoff projections for every debt combination. User
  picks preference per debt or globally.
- **Consolidation opportunity**: total high-APR consumer debt vs
  projected free cash vs a user-maintained list of available
  balance-transfer / personal-loan offers → break-even analysis with
  a concrete "would save £X over Y months" output.
- **Rate-reset warning**: `fixedRateEndDate < today+90d` on a
  mortgage → "your rate resets in N days; typical market rate Y%
  means your monthly payment changes by £Z". Feeds the Warnings
  Engine (1.8).
- **Savings-goal / accelerated-payoff calculator**: inverse math —
  "save £X/month → clear debt by date Y".

Requires one small config addition: an optional
`balance_transfer_offers.csv` so consolidation math has specific
targets rather than a generic nudge.

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
                                                                                                                                     ├─→ Income Composition (1.7) ──┤                WhatsApp (2.4)
                                                                                                                                     │                  │
                                                                                                                                     └─→ Debt Strategy (1.9) ───────┘
```

**Multi-Entity Foundation is the gate — and it is now open.** UK and UAE
books are separable at the query layer; every downstream Tier 1
feature inherits entity awareness via the `accounts` + `company`
registries and the jurisdiction-scoped `tax-rules.ts` module for
free.

**Clients + Contracts → Invoicing → Working-Days Ledger → Forecast →
Runway → Warnings** is the main income-side backbone — **1.1–1.6** are shipped.
**Next on this stack:** **1.7** (income composition) feeds **1.8** (unified
Warnings tab + multi-source severity).

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
7. **Income Composition & Diversification (1.7)** — **next** — three metrics
   (concentration, active/passive, time-independence) over the existing
   contracts + rental obligations + recurring-pipeline data, with income at
   face value and expenses where they already live. One new canonical
   registry (`properties/`) for the rent ↔ mortgage join, plus a service
   module (`income-composition/`) on the §1.6 `forecast/` shape. **Emits
   `riskSignals[]` into §1.8** as a typed discriminated union — each variant
   carries its own primitives next to `code` and `severity` (no baked prose),
   including a per-property `leveraged-passive-income` signal that surfaces
   the leverage truth without fudging the income side. **No** new income CSV;
   no goal tracking in scope.
8. **Solvency Warnings Engine (1.8)** — **What you get:** a **Warnings**
   tab: a **ranked list** of concrete problems — **forward-looking**
   (“VAT due in 60 days…”) **and** **material in-flight** issues (e.g.
   unbudgeted ad-hoc spend from **Dashboard nudge** signals, escalated
   with traffic-light severity so Careem-style leakage sits next to tax
   and contract risk). Same schema: `severity`, **recommended_action**,
   traceable `sources[]` — not another chart wall. The Overdue hero is
   *past-tense* (“you missed”); 1.8 is *future-tense* or *right now* at
   scale (“you **will** be short unless…” / “this line item is
   **too big** to leave untracked”). **Why it matters after 1.5:** 1.5
   is the **trajectory**; 1.8 is the **interpreted risk surface**
   (earmarking, reservoir vs obligation, cross-signal from contracts / tax
   / invoices / 1.7 / **spend**). That list is the **single spine** for
   Alert Queue (2.3) and Confidence Score (2.2) — thin adaptors, not
   parallel logic. Placed **after 1.7** so income-diversification
   signals are first-class on day one.
9. **Debt Strategy Advisor (1.9)** — rule-based recommendations on
   top of the existing debt table.
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
