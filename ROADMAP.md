# Feature Roadmap

> This app is not a finance tracker. It is a **threat elimination system for financial surprises**.
>
> Everything below is organized around one principle: closing the gap between "I can see what happened" and "nothing can surprise me."
>
> **What's shipped (Tier 0):** obligations registry, HMRC auto-seeders (VAT / CT / SA / TTP), budgets, recurring detection, overdue hero, missed-obligation detector, multi-currency foundations (GBP + AED), and the Deadlines tab + calendar + ICS export.
>
> **What's shipped (Tier 1):** the **Multi-Entity Foundation (1.1)** — UK Ltd + UAE FZCO modelled end-to-end through `accounts` / `company` / `tax-rules.ts` with per-entity VAT / CT scoping, inter-company classification, and Wise as a first-class intermediary — and **Clients, Contracts & Renewals — Phase A (1.2.A)** — canonical `clients` / `contracts` registries with build-time FK joins and a `contract-renewal` deadline auto-seeder. Detail in the sections below.
>
> **What's left (Tier 1):** the business now spans two legally distinct entities — **Autonize IT Limited** (UK, operational since 2014) and **Autonize IT Software Development – FZCO** (UAE, operational from March 2026) — most engagements agency-mediated (La Fosse → Edwin) and some direct (Delta Capita), with both self-billed and supplier-issued mechanisms in play. Remaining Tier 1 work: **1.2.B** templates + recipient routing, **1.2.C** timeline-aware payment matcher, **1.2.E** Contracts tab (books leave against any / all active contracts, writes a minimum-viable leave ledger, surfaces per-contract period income accrual); then invoicing (outbound + self-bill), the full working-days ledger, cash-flow forecast, warnings engine, debt-strategy advisor, and the agent / notification layer.

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

- **Entity registry** at `autonize-it/company.csv` (UK Ltd + UAE
  FZCO). Every account carries an `entityId` including the
  `wise-ltd` intermediary.
- **Jurisdiction-scoped tax rules** at `server/config/tax-rules.ts`
  cover UK VAT / CT / SA + UAE VAT / CT thresholds. Every VAT / CT
  SQL query routes through `buildAccountInFilter(accounts)` driven
  off the `accounts` registry's `vatApplicable(ByEntity)` /
  `corpTaxApplicable(ByEntity)` indexes.
- **Inter-company pair-finder** handles cross-entity transfers
  (Barclays ↔ Wise ↔ Emirates Islamic) instead of netting them out,
  with `INTER_COMPANY_EXCLUSION_PATTERNS` suppressing
  description-based false positives. Classifications
  (loan / capital / service fee) live in
  `autonize-it/transaction-category-overrides.csv`.
- **`/api/warnings/entity-foundation`** emits six branches (TBC
  fields, FZCO CT status, UAE VAT thresholds × 2, IFZA renewal
  window, unclassified inter-company count).
- **IFZA license renewal** seeded in `deadlines/deadlines.csv` and
  on the unified feed + ICS.

### 1.2 Clients, Contracts & Renewals

**Not a CRM. A structural anchor for every income-side calculation
downstream.** Today the app sees income only as bank deposits with
narrative strings. It has no concept of *who* is paying, *via which
route*, *under which contract generation*, or *when that generation
ends*. That invisibility is what lets a contract wind down in 30 days
with the forecast still showing green.

Both real-world shapes are first-class. Most engagements are
**agency-mediated** (a recruitment agency is the payer + self-bill
issuer, the end client is where the work actually happens, e.g. La
Fosse → Edwin); some are **direct** (no agency, client pays
directly, e.g. Delta Capita). The schema serves both without forcing
one into the shape of the other.

Ships in five phases: **A — Foundation** (registries + renewal
deadlines) SHIPPED; **B — Templates**, **C — Payment Matcher
timeline**, **D — Clients page UI**, and **E — Contracts tab +
minimum-viable leave writer + period-scoped income accrual**
remain.

#### 1.2.A Foundation: registries + renewal deadlines ✅ SHIPPED

Four shipped artefacts:

- **`clients` canonical registry** (`server/domain/clients/`) — Zod
  discriminated union `DirectClientSchema | AgencyClientSchema`
  backed by a flat CSV; indexes `byId` / `byKind` / `active` plus a
  pure `resolveTemplatePath(clientId, kind)` helper.
- **`master-agreements` minimal loader**
  (`server/domain/master-agreements/`) — read-only, memoized, no
  indexes; consumed only by `contracts/registry.ts` at build time.
- **`contracts` canonical registry** (`server/domain/contracts/`) —
  build-time FK join to `clients + company + master-agreements`;
  indexes `byId` / `byClient` / `byClientAndEntity` (sorted by
  `start_date`) / `byMaster` / `active`; queries
  `findContractForTransaction(clientId, entityId, date)` and an
  atomic `upsertContract` write path.
- **Renewal deadline auto-seeder**
  (`server/domain/contracts/deadline-seeder.ts`) — for every active
  contract with an `end_date`, seeds `id =
  contract-renewal-${contract.id}`, `type = 'contract-renewal'`,
  `dueDate = end_date − renewal_warning_days`. Idempotent;
  user-completed rows are never reopened. Flows through the
  existing `buildDeadlineFeed()` → list / calendar / ICS feed.

**Shipped schemas**

`clients/clients.csv` header order:

```
id, legal_name, trading_name, kind (direct | agency),
vat_number, billing_address,
primary_contact_name, primary_contact_email,
secondary_contact_name, secondary_contact_email,
hr_contact_name, hr_contact_email,
accounts_contact_name, accounts_contact_email,
cc_emails,
end_client_legal_name, end_client_address,             -- required iff kind=agency
end_client_primary_contact_name, end_client_primary_contact_email,
end_client_secondary_contact_name, end_client_secondary_contact_email,
holiday_system_url, client_assigned_email,
active, updated_at
```

`clients/master-agreements.csv`:

```
id, client_id, reference,
start_date, end_date,                                  -- end_date nullable
company_notice_weeks, supplier_notice_weeks,
jurisdiction, signed_at, docusign_envelope,
active, updated_at
```

`clients/contracts.csv`:

```
id, client_id, issuing_entity_id,
master_id,                                             -- FK to master-agreements (nullable)
reference,
start_date, end_date,                                  -- end_date nullable
works_monday..works_sunday,                            -- seven booleans; default Mon–Fri true
day_rate, day_rate_currency,
invoice_currency,
invoice_cadence (weekly | monthly),
invoice_mechanism (supplier-issued | self-bill),
payment_terms_days,
company_notice_weeks, supplier_notice_weeks,
renewal_warning_days,                                  -- default 30
job_title, job_description, work_location,
conduct_regs (opted-in | opted-out, nullable),         -- null iff issuing entity is non-UK
engagement_tax_status (outside-ir35 | inside-ir35, nullable),
jurisdiction, signed_at, docusign_envelope,
active, updated_at
```

**Seeded renewal deadlines** (produced on first boot by
`syncContractRenewalDeadlines()`):

- `contract-renewal-lf-2026-mar` due **2026-01-30** (60 days before
  2026-03-31).
- `contract-renewal-dc-sow-2026` due **2026-12-31** (60 days before
  2027-03-01).

#### 1.2.B Templates — remaining

Rendering + recipient resolution on top of the shipped registries.
The near-term consumer is **1.2.E**'s leave-booking flow, so `leave`
is the first template kind to land; `sickness`, `invoice-cover`, and
`renewal` follow in the same module with identical signatures.

**File convention.** Handlebars-style template files at
`clients/templates/{kind}.hbs` (shared across every client — one
template per kind, diverged through `{{client.*}}` context
variables rather than file copies). A per-client override at
`clients/templates/{client_id}/{kind}.hbs` is supported by
`resolveTemplatePath(clientId, kind)` but **no overrides are
committed on first ship** (YAGNI — DC and La Fosse share body and
diverge only through context). Kinds shipping in 1.2.B: `leave`,
`sickness`, `invoice-cover`, `renewal`. `.hbs` extension (not
`.md`) because the file is a template — the rendered output happens
to be short plain-text bodies, but the source is machine-processed,
not a human-authored document.

**Engine.** Minimal `{{handlebars}}`-style interpolation —
`{{client.legal_name}}`, `{{contract.reference}}`,
`{{leave.range_label}}`, `{{recipient_name}}`, plus `{{#each
leave.dates}}` blocks for per-day bullet rendering and `{{#if
path}}…{{/if}}` for truthy-field gating. No inverse `{{#else}}`, no
nested helpers, no partials. Hand-rolled or a zero-dep micro-lib;
template logic is explicitly out of scope (all branching happens in
the recipient resolver and the context builder, not in the `.hbs`
file).

**Context schema.** Typed Zod schema at
`server/domain/templates/schema.ts` so templates cannot silently
drift from contract shape:

```
{
  client,        -- full Client row (direct | agency discriminated)
  contract,      -- full Contract row, joined to issuing entity
  consultant,    -- { name, email } from company.csv
  leave: {       -- populated only for kind = 'leave' | 'sickness'
    dates: string[],             -- ISO, sorted, one entry per working day
    range_label: string,         -- "Mon 4 May – Fri 8 May 2026" etc.
    type: 'holiday' | 'sick',    -- personal-records only; never surfaced in body
  } | null,
  recipient_name,-- pre-resolved salutation name (direct primary / agency end-client primary)
  today,         -- ISO date the render was kicked off
}
```

**Rendering surface.** One pure function:

```
renderTemplate({ kind, client, contract, context })
  → { subject, body, recipients: { to: string[], cc: string[] } }
```

No I/O side effects. File read is performed by the wrapper (or
cached at module load); `renderTemplate` itself is a pure function
of its inputs. Called by 1.2.E's preview path today, by 2.3's send
adaptor later.

**Recipient resolution.** Lifted into a named pure function
`resolveRecipients(kind, client) → { to, cc }`. The existing matrix
becomes the acceptance test:

| Template | `kind = direct` (Delta Capita) | `kind = agency` (La Fosse / Edwin) |
|---|---|---|
| Leave / sickness / time-off notice | primary contact | **end-client contact** (agency silent) |
| Invoice cover note | primary contact | **end-client contact** |
| Renewal discussion | n/a — client handles direct | **agency primary contact** (end client not copied) |
| Timesheet submission | n/a (supplier-issues invoices) | **agency primary contact** |

`client.cc_emails` (comma-separated) is appended verbatim to `cc`
in every case; `client.hr_contact_email` /
`client.accounts_contact_email` only route when the template kind
calls for them.

**Structured errors.** Every failure mode is a named error type,
not a string:

- `DirectClientHasNoAgencyRenewalFlow` — raised when a `renewal`
  template is requested against a `kind = direct` client.
- `TimesheetNotApplicableForSupplierIssued` — raised when a
  `timesheet` template is requested against a contract whose
  `invoice_mechanism = supplier-issued`.
- `TemplateMissing` — the `.hbs` file for `(clientId, kind)` is
  absent on disk (neither per-client override nor shared fallback).
- `TemplateContextInvalid` — the resolved context failed the Zod
  schema (typically a `TBC` field leaking through for a template
  that requires a concrete value).

**Acceptance tests.**

- `renderTemplate({ kind: 'leave', client: deltaCapita, ... })`
  resolves `to = ['lily.lovegrove@deltacapita.com']` and
  `cc = ['philip.coleman@...', 'william.swift@...',
  'hrandrecruitment@deltacapita.com', 'dan.hedley@deltacapita.com']`;
  La Fosse untouched.
- `renderTemplate({ kind: 'leave', client: laFosse, ... })`
  resolves `to = ['<aidan end-client email>']` with La Fosse
  excluded from both `to` and `cc` entirely.
- `renderTemplate({ kind: 'renewal', client: deltaCapita, ... })`
  throws `DirectClientHasNoAgencyRenewalFlow`.

**Non-goals.** Template editor UI, template versioning, template
inheritance, email delivery (stays in 2.3), per-environment
template overrides.

#### 1.2.C Payment matcher — timeline-aware

Make the existing payer-name heuristic contract-aware:

- Match rule extends to `(payer_name heuristic matches) AND
  (transaction.date ∈ [contract.start_date, contract.end_date])
  AND (transaction.account.entity_id = contract.issuing_entity_id)`.
  Follow-on rows (a new contract for the same `(client_id,
  issuing_entity_id)` pair starting at or after the prior row's
  `end_date`) naturally extend the matching window — resolution is
  positional via the `byClientAndEntity` index, not a `type` column.
- A La Fosse payment landing on Barclays in **April 2026 or later**
  = anomaly → warn "payment from known payer outside any active
  contract window; expected on FZCO" (once the FZCO cutover
  contract is added).
- A La Fosse payment landing on Emirates Islamic before the
  relevant FZCO contract's `start_date` = anomaly → warn "payment
  predates contract start".
- Both are warnings, not hard errors — late payments for prior
  contracts and advance payments for new contracts are legitimate
  and require manual classification.

Acceptance test: a Barclays deposit with narrative matching La
Fosse, dated after `lf-2026-mar.end_date`, emits the anomaly
warning rather than silently attributing to any contract.

#### 1.2.D UI — Clients page ✅ SHIPPED

End-client-first tiled view over `/api/clients` + `/api/warnings/entity-foundation`. `partitionClientsForUi` projects each registry row onto the UI: direct rows surface once (Delta Capita — edits the client row), agency rows surface twice (Edwin Group — edits the `la-fosse` row's end-client block; La Fosse — edits the agency-level fields). `PUT /api/clients/:id` is the only write path, backed by a narrow `updateClient` helper that merges → validates → atomically rewrites the CSV → invalidates the registry; kind flips are rejected explicitly so pinned contracts and template overrides can't be orphaned. Kind-aware edit modal drives every field from a single declarative descriptor, and `client-tbc-fields` warnings surface as per-tile badges so unresolved contacts are visible before opening the form.

#### 1.2.E Contracts Tab

**The first UI consumer of the contracts spine.** A dedicated
top-level tab that answers two questions on every render: *what am
I on the hook for right now?* and *if I book N days off, what does
that do to my income this period?* Leave-booking writes into the
ledger schema from 1.4, so this is also the point at which leave
first becomes real data rather than intent.

- **UI location:** new top-level `Contracts` tab registered in
  `[public/src/modules/tabs.ts](public/src/modules/tabs.ts)`, next
  to Deadlines. Module at
  `[public/src/modules/contracts.ts](public/src/modules/contracts.ts)`.
- **List view:** all contracts, active-first, inactive collapsed
  under a disclosure. Per row: `id`, client legal name, issuing
  entity badge (UK Ltd / FZCO), reference, `day_rate` + currency,
  `start_date → end_date`, invoice cadence + mechanism, and three
  live figures — **worked-days-to-date** (period), **accrued-to-
  date** (native currency, GBP equivalent shown when they differ),
  and **projected period total**. Aggregate "Accrued this period"
  banner across all active contracts at the top of the tab,
  broken down per `issuing_entity_id`.
- **Detail drawer:** expanding a row reveals the full contract
  field set plus the contract's own leave log (rows from
  `working-days/leave.csv` filtered by `contract_id`). Future-
  dated leave rows expose an inline remove action; past-dated rows
  are read-only.
- **"Book Leave" flow:**
  - Scope selector: single contract (default when launched from a
    row) OR multi-select across all active contracts (default "all
    active" when launched from the aggregate header button).
  - Date picker: inclusive start/end range or single-date toggle.
    Days that no selected contract works (per each contract's
    `works_*` mask) render greyed out but remain selectable if the
    user explicitly opts in.
  - Leave type selector: two values only — `holiday | sick` — for
    the contractor's own record-keeping. No `paid` flag and no
    `unpaid | company-closure | bank-holiday | public-holiday`:
    outside-IR35 contracting has no paid-leave concept (no work →
    no invoice line → effectively unpaid), company closures are
    booked as `holiday`, and public holidays / bank holidays are
    calendar events handled by a separate
    `working-days/public-holidays.csv` feeding `excludeDates`, not
    leave rows.
  - **Per-contract template preview panel.** For each selected
    contract, calls
    `renderTemplate({ kind: 'leave', client, contract, context })`
    from 1.2.B and renders the resolved `To:` / `CC:` list above
    the interpolated template body in a read-only pane. The
    preview is purely informational in 1.2.E — actual email send
    lives in 2.3.
  - Confirm writes N rows to `working-days/leave.csv` (one row
    per `date × contract_id`), then refreshes the accrual numbers
    in place without a full tab reload.
- **Minimum-viable leave writer (carve-out from 1.4).** Full 1.4
  remains the home of the working-days ledger, but 1.2.E needs a
  place to persist the leave rows it creates. The subset that
  ships here is deliberately narrow:
  - `working-days/leave.csv` with the columns defined in 1.4
    (`id, contract_id, date, type, notes, external_logged,
    created_at, updated_at`) — schema landed by 1.2.E, populated
    by 1.2.E and (later) 1.4.
  - Atomic upsert keyed on `id = {contract_id}-{date}`.
  - CSV I/O module and a canonical `server/domain/leave/` registry
    (queries + fixtures + manifest test) following the 3.6
    pattern.
  - HTTP surface: `POST /api/contracts/:id/leave` (accepts a
    `{ dates: string[], type, notes? }` body),
    `DELETE /api/contracts/:id/leave/:leaveId`,
    `GET /api/contracts/:id/leave` (read the per-contract log for
    the detail drawer).
  - Everything else 1.4 specifies — public-holiday auto-seeder,
    per-month calendar UI, reconciliation vs invoices'
    `days_billed`, implied-leave seeding from the 9 historical DC
    months, UK/UAE jurisdiction routing — continues to extend
    this spine without reshaping it.
- **Minimal income accrual endpoint** (the forecast link the
  roadmap's current "1.5 is far away" gap leaves missing):
  - `GET /api/contracts/:id/income-accrual` returns
    `{ contract_id, period_start, period_end, worked_days_to_date,
    accrued_to_date, worked_days_remaining, projected_period_total,
    leave_days_in_period, day_rate, currency }`.
  - `period_start..period_end` is the current invoice period
    derived from `invoice_cadence` (weekly: ISO week Monday →
    Sunday; monthly: calendar month) clipped to
    `[contract.start_date, contract.end_date]`.
  - `worked_days` = weekday mask from `works_*` booleans minus
    every leave row overlapping the period. Since the schema has
    no `paid` flag (outside-IR35: no leave is billable), one
    `leave_days_in_period` counter is sufficient — there is no
    paid-vs-unpaid split to surface.
  - Aggregate endpoint `GET /api/contracts/income-accrual` returns
    the same shape per active contract plus a roll-up per
    `issuing_entity_id` (UK Ltd GBP, FZCO GBP, FZCO AED-equivalent
    once such a contract exists).
- **Dependencies.** Requires 1.2.A (shipped) and 1.2.B (templates)
  to land first — the preview panel is a hard dependency on
  `renderTemplate` / `resolveRecipients`. Does **not** block on
  full 1.4; the MV leave writer above is sufficient.

**Acceptance criteria:**

- `GET /api/contracts/income-accrual` on first boot returns both
  seeded contracts (`dc-sow-2026`, `lf-2026-mar`) with zero leave
  rows and the day counts expected for the current ISO week /
  calendar month against their respective `works_*` masks.
- Booking 3 `holiday` days (Mon–Wed) for `lf-2026-mar` writes 3
  rows to `working-days/leave.csv`, reduces
  `worked_days_remaining` by 3, and reduces
  `projected_period_total` by `3 × £550 = £1,650` on that
  contract's next accrual read.
- Booking 1 day scoped to "all active contracts" on a Monday that
  both contracts work writes 2 leave rows (one per contract)
  sharing the same `date` but distinct `contract_id`, and reduces
  both contracts' projections independently.
- Booking a date outside `[contract.start_date, contract.end_date]`
  returns a 422 with a structured `LeaveOutsideContractWindow`
  error rather than silently writing.
- Leave template preview for `dc-sow-2026` resolves
  `to = ['lily.lovegrove@deltacapita.com']` and
  `cc = ['philip.coleman@...', 'william.swift@...',
  'hrandrecruitment@deltacapita.com', 'dan.hedley@deltacapita.com']`.
- Leave template preview for `lf-2026-mar` resolves
  `to = ['<aidan end-client email>']` with La Fosse excluded from
  both `to` and `cc`.
- Removing a future-dated leave row from the detail drawer
  restores the accrual numbers to their pre-booking state on the
  next read.

**Non-goals (carved out to respect the additive-structure
decision):**

- Full monthly-grid leave calendar UI — stays in 1.4.
- Public-holiday auto-population per jurisdiction — stays in 1.4.
- Reconciliation of ledger-derived `days_worked` against issued
  invoices' `days_billed` — stays in 1.4.
- Implied-leave seeding from the 9 historical DC months — stays
  in 1.4.
- Actual email send of drafted templates — stays in 2.3 (Alert
  Queue).
- External holiday-portal sync (DC contractor portal, Edwin
  timesheets) — Tier 3.
- Multi-period / rolling 30 / 60 / 90-day cross-account forecast
  — stays in 1.5. The accrual endpoint here is deliberately
  scoped to the **current** invoicing period only; it answers
  "what will this contract invoice for this week / this month?"
  and nothing beyond the period boundary.

**Follow-ups shipped on top of 1.2.E:**

- **Retained-after-tax aggregate** (shipped). Per-entity banner
  tiles now lead with **Retained** — incoming (net + VAT) minus
  VAT-to-HMRC minus a flat CT reserve (UK Ltd 25% via
  `CORPORATION_TAX.MAIN_RATE`; FZCO 0% when QFZP-qualifying, 9%
  otherwise via `UAE_CORPORATION_TAX`) — so gross projected income
  stops masquerading as the company's money. All math sits in
  `calculateRetainedReserves` alongside the existing tax helpers.
  Personal take-home (salary + dividend + personal tax) deferred
  until a pay plan is confirmed with the accountant.
- **Accrual since last payment** (shipped). Per-contract owed
  figures (`worked_days_to_date`, `leave_days_in_period`,
  `accrued_to_date`) are now rebased onto a narrative-matched
  last-invoice-payment date (via `findLastInvoicePaymentDate` +
  `resolveAccrualWindowStart` in
  `server/domain/contracts/last-payment.ts`), falling back to
  month-start when no payment matches (new contracts, FZCO before
  the first AED deposit lands). `projected_period_total` stays
  pinned to the calendar month, so the Retained / VAT / CT banner
  is numerically unchanged. Tile labels renamed to "Worked since
  last payment" / "Leave since last payment" with a hover tooltip
  showing the window range. Amount-tolerance fallback is
  implemented but gated off (`enableAmountFallback: false`),
  waiting for the invoicing ledger in 1.3 to provide a
  deterministic invoice↔payment link.

#### Non-goals

- Actual email sending — lives in 2.3 (Alert Queue delivery).
- External holiday-system integration (e.g. DC's contractor
  portal) — stays as `holiday_system_url` + a manual-cleared flag
  on the leave entry.
- CRM features (activity log, pipeline, notes) — explicitly out of
  scope.
- Auto-fill of end-client contacts from public company registries
  — Tier 3.
- Historical La Fosse renewals (paying into Barclays prior to
  March 2026) back-seeded into `clients/contracts.csv` — Tier 3
  data-quality cleanup. When those contracts are located, back-
  seeding them rebuilds prior-year payment↔contract matching
  retroactively; the registry's build-time FK validation makes
  this a safe drop-in edit.

### 1.3 Invoicing System

**Two co-equal flows, both shipped in this release.** Supplier-issued
(the app generates and issues the invoice PDF) for direct contracts
like Delta Capita; self-bill ingestion (the payer issues, the app
parses) for agency contracts like La Fosse. Neither is an enhancement
to the other — they are parallel paths selected by the contract's
`invoice_mechanism` column.

**Schema — `invoices/invoices.csv`**

```
id,                                          -- e.g. UK-0011, FZ-0001
contract_id, client_id, issuing_entity_id,
invoice_number,                              -- same as id, kept for parser output
payment_reference,                           -- cited by client on deposit; usually = invoice_number, tracked separately so stale refs are visible in the reconciler
invoice_date,

-- line item
period_start, period_end, days_billed,
description,                                 -- narrative shown on the PDF's Item cell (e.g. "David Morrison - Consultant Services, Software Development"); rendered above the formatted period range

-- currency and amounts (always in invoice_currency)
currency,                                    -- invoice-denominated
subtotal, vat_rate, vat_amount, total,

-- FX capture at issue (for cross-currency invoices)
fx_rate_at_issue,                            -- GBP/AED or other cross-pair
fx_base_currency,                            -- typically 'GBP'

mechanism (supplier-issued | self-bill),
pdf_path,                                    -- relative to invoices/
status (draft | issued | paid | partial | overdue),
due_date,

created_at, updated_at
```

- `currency` is the invoice-denominated currency (GBP for both DC
  and La Fosse, even though FZCO banks in AED). Deposit currency
  may differ per payment — captured in `invoice_payments.csv`.
- Per-entity sequences: UK Ltd uses `UK-0001`, `UK-0002`…; FZCO uses
  `FZ-0001`, `FZ-0002`…. Never a global sequence — HMRC and FTA
  audit trails must remain separable.
- `description` is seeded verbatim from the existing PDF for the 10
  historical DC rows; for new generated invoices the default template
  is `"{consultant.name} - Consultant Services, {contract.job_title}"`
  with the formatted `period_start - period_end` string rendered as a
  second line in the Item cell.
- `payment_reference` defaults to `invoice_number` at generation time;
  the separate column exists so the reconciler can flag cases where
  the client pastes an old reference (every DC invoice from DC-002
  through DC-010 in the historical-rows fixture below shows exactly
  this failure and relies on this column to surface it).

**Schema — `invoices/invoice_payments.csv`**

```
id, invoice_id, bank_transaction_id,
payment_date,
amount_paid,                                 -- in deposit_currency
deposit_currency,
fx_rate_at_payment,                          -- snapshot at deposit time
amount_in_invoice_currency,                  -- converted back for reconciliation
fx_gain_loss,                                -- amount_paid_gbp_equivalent - invoice.total_gbp_equivalent
residual,                                    -- invoice.total − Σ(payments converted)
created_at, updated_at
```

- `fx_rate_at_issue − fx_rate_at_payment` × amount = realised FX
  gain/loss per payment. Relevant to both jurisdictions' books once
  repatriation or consolidation happens.

**Outbound flow (supplier-issued, Delta Capita shape)**

- Generator picks a PDF template by `contract.issuing_entity_id`:
  - `autonize-it-ltd` template: Autonize IT Limited header,
    Companies House 08842112, VAT 292 1465 96, BACS sort/account,
    SVG logo rasterised to PNG.
  - `autonize-it-fzco` template: Autonize IT Software Development –
    FZCO header, License 73348, Registration 71347, IBAN + SWIFT
    (once captured), **no VAT line** (not VAT-registered).
- Logo: `autonize-it/logo.svg` committed once; rasterised at invoice
  generation time via `sharp` (SVG→PNG).
- PDF engine: `pdfmake` — lightweight, declarative, no Chromium
  dependency. Rejected Puppeteer (~300MB Chromium) and pdf-lib
  (verbose for this layout).
- Invoice pre-fills `days_billed` from the Working-Days Ledger (1.4)
  once that ships; until 1.4, the UI exposes a manual day count
  input.
- State transitions: `draft → issued → paid | partial`. `overdue` is
  derived (`due_date < today AND status != paid`), not stored.

**Inbound flow (self-bill, La Fosse shape)**

- PDF parser slot in `server/invoices/parsers/`, mirroring the bank
  parser pattern in `server/parsers/`.
- First parser: `la-fosse.ts` — extracts invoice number, period, day
  rate, days worked, subtotal, VAT, total, issue date, currency.
- Ingestion routes a parsed row into `invoices.csv` with `mechanism =
  self-bill`, `status = issued` (La Fosse considers self-bill
  simultaneous with issue).
- **Assertion**: if a parsed La Fosse invoice shows a non-zero VAT
  amount against a non-VAT-registered issuer (FZCO), flag for manual
  review. Expected to never fire per the self-billing agreement
  (FZCO VAT = N/A), but the assertion catches parser bugs and catches
  a silent FTA registration the user forgot to record.
- Manual-entry form is the universal fallback for any contract
  without an automated parser.

**File / directory layout**

```
invoices/
├── invoices.csv
├── invoice_payments.csv
├── templates/
│   ├── autonize-it-ltd.pdf.json             (pdfmake doc definition)
│   └── autonize-it-fzco.pdf.json
├── generated/                                (outbound PDFs, path in invoices.pdf_path)
│   └── UK-0011.pdf
└── ingested/                                 (inbound self-bill PDFs)
    └── LF-2026-W10.pdf
server/invoices/
├── generator/
│   ├── render-ltd.ts
│   └── render-fzco.ts
├── parsers/
│   ├── la-fosse.ts                           (first self-bill parser)
│   └── ... (future)
└── reconciler.ts
```

**Payment reconciliation**

- Reuses the existing `matchPaymentsToSlots` machinery from the
  HMRC seeders — this is not new code.
- Matches by `(payer_name heuristic, amount within FX tolerance,
  deposit_date near due_date window, account.entity_id =
  invoice.issuing_entity_id)`.
- Cross-currency tolerance for GBP-invoice / AED-deposit scenarios
  uses the snapshot FX rate ±5% — beyond that, flagged as "FX drift
  on unpaid invoice".
- Reverse lookup preserved: "where is my invoice for this £2,400
  deposit?" surfaces as a one-click query on the transaction row.

**Seed data — historical DC fixtures (10 rows, known-good) + La Fosse placeholders**

`invoices/invoices.csv` — 10 historical DC rows parsed from the
existing PDFs. `days_billed` is as written on the invoice;
`days_worked_derived` (computed by 1.4's reconciler) is what the
Working-Days Ledger *should* produce from the contract pattern +
leave rows — the reconciliation pair.

| id | date | period | days | rate | net | vat | gross | due | payment_ref (as written) | issues the reconciler must flag |
|---|---|---|---:|---:|---:|---:|---:|---|---|---|
| DC-001 | 2025-07-09 | 23/06 – 30/06/2025 | 6 | 550 | 3,300.00 | 660.00 | 3,960.00 | 2025-08-09 | DC-001 | — |
| DC-002 | 2025-08-11 | 01/07 – 29/07/2025 | 19 | 550 | 10,450.00 | 2,090.00 | 12,540.00 | 2025-09-11 | **DC-001** | `payment_ref` stale (should be DC-002) |
| DC-003 | 2025-09-24 | 01/08 – 29/08/2025 | 20 | 550 | 11,000.00 | 2,200.00 | 13,200.00 | 2025-10-01 | DC-003 | due date only 7 days after issue (30-day terms → 2025-10-24) |
| DC-004 | 2025-10-07 | 01/09 – 30/09/2025 | 20 | 550 | 11,000.00 | 2,200.00 | 13,200.00 | 2025-11-01 | DC-004 | due date 25 days after issue (30-day terms → 2025-11-06) |
| DC-005 | 2025-11-03 | 01/10 – 31/10/2025 | 20 | 550 | 11,000.00 | 2,200.00 | 13,200.00 | 2025-12-01 | **DC-004** | `payment_ref` stale; due date off by 2 days |
| DC-006 | 2025-12-05 | 01/11 – 30/11/2025 | 18 | 550 | 9,900.00 | 1,980.00 | 11,880.00 | **2025-01-05** | **DC-004** | due date year wrong (should be 2026-01-04); `payment_ref` stale |
| DC-007 | 2026-01-03 | 01/12 – 31/12/2025 | 21 | 550 | 11,550.00 | 2,310.00 | 13,860.00 | 2026-02-02 | **DC-004** | `payment_ref` stale |
| DC-008 | 2026-02-08 | **05/01 – 30/12/2025** | 20 | 550 | 11,000.00 | 2,200.00 | 13,200.00 | 2026-03-08 | **DC-004** | period clearly wrong (likely 01/01 – 30/01/2026); `payment_ref` stale |
| DC-009 | 2026-03-01 | 01/02 – 28/02/2026 | 20 | 550 | 11,000.00 | 2,200.00 | 13,200.00 | 2026-04-01 | **DC-004** | `payment_ref` stale |
| DC-010 | 2026-04-01 | 01/03 – 31/03/2026 | 17 | 550 | 9,350.00 | 1,870.00 | 11,220.00 | **2031-05-01** | **DC-004** | due date year wrong by 5 years (should be 2026-05-01); `payment_ref` stale |
| **Sum** | | 181 billable days | | | **99,550.00** | **19,910.00** | **119,460.00** | | | |

Every bolded cell above is a warning the reconciler must emit by
construction. Seven of the ten would have been prevented entirely had
the invoices been generated from the clients + contracts + Working-
Days Ledger spine rather than copy-pasted templates. This set is the
first regression test fixture for 1.3's warning path, and the single
strongest argument for why 1.1 → 1.2 → 1.3 is the correct build order.

**Known-good totals (must reach from both invoice and bank sides)**

- Net issued: **£99,550.00**
- VAT issued: **£19,910.00**
- Gross issued: **£119,460.00**
- Billable days issued: **181** (23-Jun-2025 → 31-Mar-2026)

La Fosse self-bill fixtures: `TBC`. The first real self-bill PDF
received from La Fosse becomes the parser's golden fixture. Until one
is in hand, committed as placeholder rows with `pdf_path = TBC` so
downstream features can still be wired against the schema.

**Acceptance criteria**

- Generate a DC-style invoice from `(contract_id =
  dc-sow-2026, period = 2026-04-01..2026-04-30, days = 20)`
  → produces a PDF with UK Ltd header, SVG logo rasterised to PNG,
  VAT line at 20%, BACS details footer. Filename `UK-0011.pdf` (or
  next in sequence), written to `invoices/generated/`.
- Generate a hypothetical FZCO-direct invoice (not expected in
  current seed data but must work structurally) → produces a PDF
  with FZCO header, IBAN/SWIFT footer, **no VAT line**.
- Parse a La Fosse self-bill PDF → produces an invoice row with
  `issuing_entity_id = autonize-it-fzco`, `currency = GBP`,
  `mechanism = self-bill`, `vat_amount = 0`.
- Self-bill with non-zero VAT against FZCO → review-flag warning.
- Cross-currency reconciliation: GBP-denominated invoice of £2,000
  matches AED deposit on Emirates Islamic at AED/GBP snapshot rate;
  FX gain/loss captured on the payment row.
- UK→FZCO transition: a hypothetical La Fosse invoice dated before
  2026-03-02 is assigned sequence `UK-xxxx`; one from 2026-03-02
  onwards is assigned `FZ-xxxx`.
- All 10 DC historical rows import cleanly; 7 emit the documented
  warnings above.

**Non-goals**

- Email delivery of issued invoices — 2.3.
- OCR for scanned / image-only self-bill PDFs — Tier 3. (Called
  out explicitly because the FZCO Certificate of Formation PDF was
  image-only and exposed the lack of OCR during roadmap authoring.)
- Automated fetch from La Fosse's email / portal — Tier 3.
- Multi-jurisdiction VAT returns (UK VAT + UAE VAT simultaneously)
  — Tier 1.8 picks this up once FZCO has UAE VAT registered.

### 1.4 Working-Days Ledger (income-side counterpart to obligations)

**The forecasting cornerstone.** Income today is invisible until an
invoice is issued or a payment lands. With day rate + calendar +
`works_*` booleans, income becomes continuously derivable: at any
moment the system can say exactly how much has accrued per active
contract, per entity.

**Schema — `working-days/leave.csv`**

```
id, contract_id,                             -- entity + currency derived transitively
date,
type (holiday | sick),                       -- personal-records only; 2 values
notes,
external_logged,                             -- cleared when user has logged in client's portal
created_at, updated_at
```

- Working days are **derived**: everything the contract's
  `works_*` booleans cover, minus any leave row for the same date,
  minus automatic public-holiday rows.
- Ledger is leave-only. "Working" is the default, not a row. This
  halves the row count versus storing every day.
- No `paid` column: outside-IR35 contracting has no paid-leave
  concept (no work → no invoice line → effectively unpaid), so
  every leave row reduces billable income symmetrically. Downstream
  callers that historically branched on `paid` (e.g. a future
  `countUnpaidLeave(period)` helper) collapse into a single
  `countLeaveIn(period, contract)` function.
- Public holidays + company closures are **not** leave rows. They
  live in a separate `working-days/public-holidays.csv` feeding
  `excludeDates` on the working-days iterator — a calendar event,
  not a personal choice. UK public holidays auto-apply to contracts
  with `issuing_entity_id = autonize-it-ltd`; UAE public holidays
  auto-apply to contracts with `issuing_entity_id =
  autonize-it-fzco`. Two calendar feeds, not one.

**UI**

- Per-month calendar, tick a day off. Default target is "all active
  contracts" with a per-contract override when you explicitly work
  one client while off from another.
- On logging a leave day, pre-draft the contract's leave template
  (routed per 1.2's rules — end-client for agency, primary for
  direct). One confirmation to send.
- `holiday_system_url` on the client keeps leave flagged
  "needs external logging" until the user clears it.

**Downstream effects this single data model unlocks**

- **Invoice auto-fill** (1.3 generator): at invoice generation time,
  `days_billed = workingDays(period, contract) −
  countLeaveIn(period, contract)`. No recall-from-memory. All leave
  is non-billable by construction (no `paid` split), so the helper
  is a straight count rather than a filtered sum.
- **Self-bill reconciliation** (1.3 reconciler): parsed La Fosse
  self-bill's `days` field compared against ledger-derived
  `days_worked`; mismatch → warning in 1.8.
- **Forecast accrual** (1.5): `accrued_to_date(contract) = day_rate
  × workedDays_since_last_invoice`. Real-time per contract per
  entity, not invoice-lagged.
- **Solvency-warning input** (1.8): scheduled leave immediately
  shows up as a per-entity dip in projected income. Log six days
  off in August for the FZCO contract and the August reservoir gap
  for *next FZCO invoice* widens automatically.

**Seed data — implied leave rows reverse-computed from DC invoices**

For each DC-invoice month, `expected_working_days = Mon-Fri in
month − UK bank holidays`; `implied_leave = expected − invoiced_days`.
These become seed rows in `working-days/leave.csv` with `type =
holiday` (safe default; user can recategorise to `sick`
individually after ship — the only other leave type).

| month | expected Mon-Fri (− UK bank hols) | invoiced days | implied leave |
|---|---:|---:|---:|
| Jul 2025 | 23 | 19 | 4 |
| Aug 2025 | 20 (inc. 25-Aug bank hol) | 20 | 0 |
| Sep 2025 | 22 | 20 | 2 |
| Oct 2025 | 23 | 20 | 3 |
| Nov 2025 | 20 | 18 | 2 |
| Dec 2025 | 21 (inc. 25/26-Dec bank hols) | 21 | 0 |
| Jan 2026 | 21 (inc. 1-Jan bank hol) | 20 | 1 |
| Feb 2026 | 20 | 20 | 0 |
| Mar 2026 | 22 | 17 | 5 |

**Acceptance criteria**

- Ledger reconciles with every clean DC invoice: `days_worked_derived
  = invoice.days_billed` for DC-001, DC-003, DC-004, DC-005, DC-007,
  DC-009, DC-010 at minimum.
- Reconciler emits mismatch warnings for invoices where the period
  on the PDF is nonsensical (DC-008's `05/01 – 30/12/2025`).
- Forecast for current month splits into DC contribution (UK Ltd,
  GBP) and La Fosse/Edwin contribution (FZCO, GBP-denominated →
  AED-deposited). Both visible per entity.
- Logging 3 leave days for `lf-2026-mar` contract reduces FZCO
  projected income by `3 × £500 = £1,500` for the affected month.
- UK public holidays (8 per calendar year) auto-excluded from DC
  working days; UAE public holidays auto-excluded from La Fosse
  working days. Public-holiday rows live in
  `working-days/public-holidays.csv` feeding `excludeDates`, not in
  `leave.csv`.

**Non-goals**

- Per-hour tracking (this is a day-rate system) — not in scope.
- Multi-day-per-contract logic (e.g. half-days) — Tier 3 if it
  becomes needed.
- Syncing the ledger to external portals (DC's contractor system,
  Edwin's timesheet system) — Tier 3.

### 1.5 Cash Flow Forecast / Runway Projection

The single most important feature behind the whole app. With 1.1–1.4
in place, every ingredient now exists:

- `account_balances` for opening balances (already live).
- `recurring-detector` / `recurring-upcoming` for predictable
  recurring income / expenses (already live).
- Obligations registry for known future outgoings (already live).
- HMRC auto-seeders for tax liabilities (already live).
- **Multi-entity foundation (1.1)** so UK and UAE projections never
  get silently summed together.
- **Clients + contracts (1.2)** for active income streams and their
  horizons.
- **Invoicing (1.3)** for issued but unpaid invoices.
- **Working-Days Ledger (1.4)** for deterministic income accrual
  day-by-day.

Output: "what will my balance be in 30 / 60 / 90 days?" per account,
per entity, and globally. Daily resolution, not monthly. Per-entity
output is mandatory — "we have £50k total" is meaningless when £30k of
it is AED in FZCO and £20k is GBP in UK Ltd. This endpoint is what
every Tier 2 feature calls before answering anything.

### 1.6 Worst Case / Runway Mode

One button: "if all active income stops today".

- Output: runway in months, mandatory vs optional spend, survival
  threshold, per entity.
- Uses the forecast engine (1.5) + the bills / QoL split already
  computed in `expenses-insight.ts`.
- Includes available credit headroom as emergency runway — UK Ltd
  cards only count toward UK Ltd runway; no inter-company credit
  aggregation.
- Credit limit is currently approximated by each credit card's
  opening balance. Formalise this as a derived `creditLimit` on
  `AccountConfigSchema` — default to the opening balance so nothing
  changes semantically, but the intent becomes explicit and the field
  is available for future tuning.

### 1.7 Income Composition & Diversification

**Rethinks concentration from "risk within active income" to "how
dependent is my income on me showing up?"** One section, three
metrics, two new CSVs.

The original concern was single-client failure ("90% of income from
one client"). The sharper concern is single-*mode* failure: *all* of
the current income, across every active contract, stops the moment
active work stops. Measuring that is only possible once every income
source carries an activity classification.

**New data — two seeded CSVs**

- `income_sources/income_sources.csv` — non-contract income streams
  (dividends, interest, rental, SaaS MRR, royalties, referral
  payments, etc.). Contracts in `clients/contracts.csv` remain the
  source of truth for consulting-shaped income; this file catches
  everything the contract table cannot represent.
  - Columns: `id, name, entity_id, category (dividend | interest |
    rental | saas | royalty | referral | other), activity_class
    (passive | semi-passive | active), expected_monthly_amount,
    currency, payer_pattern, start_date, end_date, notes,
    updated_at`.
  - `entity_id` links a non-contract stream to UK Ltd or FZCO for
    per-entity reporting.
  - `activity_class` three-value enum drives every metric below:
    - **passive** — no ongoing time required (dividends, interest,
      long-term rental income).
    - **semi-passive** — needs maintenance but not daily work
      (SaaS MRR on a shipped product, royalties on a launched
      course, content residuals).
    - **active** — stops the moment you stop showing up
      (contracting, short-term consulting, day-rate work).
      Contracts in `contracts.csv` default to `active`; override
      only when a contract is genuinely retainer-shaped and
      time-decoupled.

- `income_sources/income_goals.csv` — target rows for income that
  doesn't yet exist but should. Mirror of the obligations registry,
  inverted: obligations are things you owe and want to shrink;
  goals are things you want and are currently short of.
  - Columns: `id, source_id (optional), name, target_type (mrr |
    total_monthly | total_annual | time_independence_pct),
    target_amount, target_date, activity_class, notes, updated_at`.
  - `current_amount` is *derived* at read time from the matching
    sources, not stored.

**Three metrics this section emits — not one**

1. **Client concentration** — `max(client_monthly_income) /
   total_active_income`. Tactical downside signal. Answers *"if one
   client drops me, how much active income do I lose?"*

2. **Active / passive ratio** — `(passive + semi-passive) monthly /
   total monthly`. Strategic diversification metric. Answers *"how
   much of my income survives if I stop working tomorrow?"* Passive
   and semi-passive split surfaced separately.

3. **Time-independence ratio** — `(passive + semi-passive) monthly /
   mandatory_monthly_outgoings`. The FIRE metric. At 100% you could
   stop trading time for money and still pay every bill.
   `mandatory_monthly_outgoings` comes from the bills / QoL split
   already computed in `expenses-insight.ts`.

**Goal tracking — both directions**

Each metric emits into the Warnings Engine (1.8) both on
*regression* (past a deterioration threshold) and on *progression*
against a goal from `income_goals.csv`. Progression warnings are the
positive feedback the app otherwise never provides.

- A goal of `target_type: mrr, target_amount: 2000, target_date:
  2027-12-31, current_amount: 0` creates a signal from day zero:
  *"0% of MRR goal met; 20 months remaining; required monthly growth
  to hit target: £100/month of new MRR from today."*
- Crossing a target emits a completion warning at severity `info`.
- The time-independence ratio is itself a natural goal
  (`target_type: time_independence_pct, target_amount: 100`).

**Why this belongs in Tier 1, not Tier 2**

All three metrics feed the Solvency Warnings Engine (1.8) and the
Confidence Score (2.2). Pushing this into Tier 2 would force both
upstream consumers to derive the activity classification themselves,
defeating the point of the warning-schema spine.

### 1.8 Solvency Warnings Engine (the Warnings tab)

**Forward-looking, ranked, specific, unprompted.** The app's single
most important output once the forecast exists. Where the Overdue Hero
surfaces *past-tense* misses, the Warnings Engine surfaces
*future-tense* structural problems:

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

Every set-wise configuration now lives at `server/domain/<name>/`
with a standard layout:

```
server/domain/<name>/
  schema.ts       Zod schema + derived TS types
  data.ts         raw literal / CSV loader
  registry.ts     build + precomputed indexes + memoization via createRegistry
  queries.ts      pure public queries over the indexes
  fixtures.ts     makeTest<Name>Registry, routed through the production build
  index.ts        barrel re-exports
  *.test.ts       schema / gates / invariants / lifecycle / queries / manifest
```

Shared primitives live under `server/domain/_shared/`:
`create-registry.ts`, `index-builders.ts`, `fixture-builder.ts`,
and `manifest-test.ts` — the capability-drift detector that
asserts every index in a registry has at least one documented live
consumer. New registries cannot merge without a manifest test;
this is enforced repo-wide by
`server/domain/_shared/all-registries.manifest.test.ts`.

**Seven canonical registries migrated:** `accounts`, `people`,
`payees`, `merchants`, `payroll`, `company`, `transaction-overrides`.
The legacy `obligations` registry is the sole exception, pinned in
the manifest-sweep's exemption list until it is migrated.

**Pattern documentation:** full rationale, test templates, naming
rule, registry directory index, and the UI-control code-review
checklist (the "a UI control must change at least one visible
field via a path not already expressed by existing config" rule
— with the Entity dropdown post-mortem as the worked example) all
live in
[docs/config-registries.md](docs/config-registries.md).

**Why this matters forward.** Every new registry — `contracts`
(1.2.A, already shipped under this pattern), `leave` (1.2.E),
`income_sources` (1.7) — slots straight in; the Warnings Engine
(1.8) becomes a reduction over named registry indexes rather than
ad-hoc scans.

---

## Dependency Chain

```
Tier 0 (Certainty) ✅       Tier 1 (Projection)                                                              Tier 2 (Agent)

Obligations + Deadlines     Multi-Entity Foundation (1.1) ✅
Multi-Entity Foundation ✅   Clients + Contracts (1.2 A–D) ─┬─→ Contracts Tab + MV leave writer (1.2.E) ─→ Working-Days Ledger (1.4) ─┐
                            Renewals (1.2)  ───────────────┘                          │                                              │
                                                                                      └─→ Invoicing (1.3) ─────────────────────────→ ┤
                                                                                                                                     │
                                                                                                                                     ├─→ Forecast (1.5) ─┐
                                                                                                                                     │                  │
                                                                                                                                     ├─→ Warnings (1.8) ─┤
                                                                                                                                     │                  ├─→ AI Primitives (2.0) ─→ Snapshot (2.1)
                                                                                                                                     ├─→ Worst Case (1.6) ┤                          Confidence Score (2.2)
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
Warnings** is the main income-side backbone. Invoicing depends on
contracts (every invoice FK's a contract); the ledger depends on
both (fills in day counts); the forecast depends on the ledger for
deterministic accrual; the warnings engine reduces over everything.

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

1. ~~**Multi-Entity Foundation (1.1)**~~ ✅ SHIPPED — see §1.1.
   `company.csv` both rows, `entityId` on every account (incl. Wise),
   jurisdiction-scoped `tax-rules.ts`, `buildAccountInFilter` driven by
   registry indexes, entity-foundation warnings endpoint, inter-company
   pair-finder + description-based exclusion patterns, Wise as
   intermediary, IFZA deadline seeded.
2. **Clients, Contracts & Renewals (1.2)** — Phase A ✅ SHIPPED:
   `clients.csv`, `clients/master-agreements.csv`, and
   `contracts.csv` with DC + La Fosse/Edwin seed rows; canonical
   `clients` / `contracts` registries (build-time FK join); `contract-renewal`
   deadline auto-seeder wired into the Tier 0 calendar. Remaining:
   **B** templates + recipient routing, **C** timeline-aware payment
   matcher (entity-aware, date-in-effect contract resolution), **D**
   Clients page UI, **E** Contracts tab (see step 3).
3. **Contracts Tab (1.2.E)** — first UI consumer of the contracts
   spine. List + detail views, Book Leave flow (single contract or
   all active contracts, date range, `holiday | sick` type, per-
   contract template preview via 1.2.B), minimum-viable leave writer
   (`working-days/leave.csv` + `server/domain/leave/` registry +
   `POST/GET/DELETE /api/contracts/:id/leave`), and the minimal
   income-accrual endpoint (`GET /api/contracts/:id/income-accrual`
   and its aggregate) so booked leave visibly moves a number on
   screen. Depends on 1.2.B; does not block on full 1.4.
4. **Invoicing System (1.3)** — outbound PDF generator for
   supplier-issued (DC shape) AND inbound parser for self-bill (La
   Fosse shape) in the same release; per-entity invoice sequences;
   FX snapshots at issue and payment; 10 DC historical rows seeded
   with their documented warnings; `pdfmake` + `sharp` wiring.
5. **Working-Days Ledger (1.4)** — extends the MV leave writer
   shipped in 1.2.E with jurisdiction-aware public holidays
   (UK + UAE), per-month calendar UI, reconciliation with 1.3
   invoice day counts, and implied-leave seeding for the 9
   historical DC months.
6. **Cash Flow Forecast (1.5)** — the single biggest behaviour
   change the app can make. Per entity, daily resolution. Extends
   the period-scoped accrual endpoint from 1.2.E into a full
   30 / 60 / 90-day cross-account projection.
7. **Solvency Warnings Engine (1.8)** — brought forward. Without it
   the forecast has no voice; with it, 2.2 and 2.3 collapse into
   thin reductions / delivery adaptors.
8. **Worst Case / Runway + formalised credit headroom (1.6)** —
   cheap once 1.5 is in.
9. **Income Composition & Diversification (1.7)** — three metrics
   (client concentration, active/passive ratio, time-independence
   ratio) plus the income-sources and income-goals registries.
   Trivial to wire for contract-shaped income once 1.2 ships; the
   non-contract registries are the real work. Emits into 1.8.
10. **Debt Strategy Advisor (1.9)** — rule-based recommendations on
    top of the existing debt table.
11. **Structured Data for AI Consumption (2.0)** — prerequisite to
    all of Tier 2. Balance + debt + tax semantic discriminators
    (2.0.A/B), expected-receipts calendar (2.0.C), contract-exposure
    enrichment (2.0.D), slice endpoints (`/api/ai/liquidity`,
    `/api/ai/pipeline`, `/api/ai/runway` in 2.0.E), thin snapshot
    composer + generated `/api/ai/manifest` (2.0.F), and a thin MCP
    server (2.0.G) that exposes the same slices as first-class
    Resources + Tools with auto-generated descriptors and both
    stdio + HTTP+SSE transports. Gates Open Close.
12. **Financial Snapshot (2.1)** + **Confidence Score (2.2)** — the
    agent's two core reads; 2.2 is a reduction over 1.8, both
    consume 2.0's slice endpoints.
13. **Alert & Notification Queue (2.3)** — delivery path for 1.8.
14. **Net Worth Snapshots (3.1)** — entity-aware from day one.
15. **Multi-Currency extensions (3.2)** — whatever did not land in
    1.1 / 1.3.
16. **Historical Invoice Parser Fallbacks (3.3)** — OCR + inbound
    automation.
17. **WhatsApp / Chat Interface (2.4)** — delivery channel, ships
    last.

---

## One-Line Summary

> You don't need more analytics — you need a system that **guarantees** no obligation
> can exist, be missed, or go unnoticed, past or future.
