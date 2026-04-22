# Feature Roadmap

> This app is not a finance tracker. It is a **threat elimination system for financial surprises**.
>
> Everything below is organized around one principle: closing the gap between "I can see what happened" and "nothing can surprise me."
>
> **What's shipped (Tier 0):** the obligations registry, HMRC auto-seeders (VAT, CT, SA, HMRC TTP), budgets, recurring detection, overdue hero, missed-obligation detector (annual / one-off non-tax items with Mark Paid + auto-match), multi-currency / FX foundations (GBP + AED), and the Deadlines tab + calendar view with ICS export.
>
> **What's left (Tier 1):** the business now spans two legally distinct entities — **Autonize IT Limited** (UK, operational since 2014) and **Autonize IT Software Development – FZCO** (UAE, operational from March 2026) — and most engagements are agency-mediated (La Fosse for the current Edwin Group work) while some are direct (Delta Capita), with some self-billed and others supplier-issued. Tier 1 builds the income-side layer that makes all of that legible to the forecast: a multi-entity foundation so UK and UAE books never cross-contaminate, a clients / contracts / renewals registry to anchor every income stream, an invoicing system that handles both outbound generation and inbound self-bill ingestion in whichever currency the contract specifies, a working-days ledger so income becomes continuously derivable, a real forecast on top of it, a ranked warnings surface, a debt-strategy advisor, and finally the agent / notification layer.

---

## Tier 0 — Certainty Layer ("Nothing Can Surprise Me") ✅ COMPLETE

Tier 0 is now fully shipped. The obligations registry (manual + HMRC
auto-seeders for VAT / CT / SA / TTP), overdue hero, missed-obligation
detector, and the Deadlines tab + calendar view are all live. The
certainty layer is visible at a glance, and every tracked obligation or
reminder is either surfaced on the Obligations tab, the Deadlines tab,
or both via the unified `/api/deadlines/feed` endpoint.

### 0.1 Deadlines Tab + Calendar View ✅ SHIPPED

- Dedicated **Deadlines tab** with a List view and a FullCalendar-based
  **Calendar view**, toggleable per session.
- Non-financial deadlines modelled in their own `deadlines/deadlines.csv`
  with CRUD at `/api/deadlines` (create, update, delete, mark done,
  reopen).
- Unified feed at `/api/deadlines/feed` merges non-financial deadlines
  with financial obligations so one list + one calendar show
  everything — driven by a single pure `buildDeadlineFeed()` function
  that both the feed endpoint and the ICS exporter consume.
- **ICS subscription** at `/api/deadlines.ics` for Google Calendar /
  Apple Calendar with stable UIDs and a `SEQUENCE` derived from
  `updatedAt` so edits propagate to subscribers instead of
  de-duplicating.
- Companies House confirmation statement seeded in
  `deadlines/deadlines.csv` as the canonical non-financial example.
- Regression-locked with 53 tests across CSV I/O, repository, feed
  builder, ICS builder, and the full HTTP routes.

---

## Tier 1 — Projection Layer ("What's Coming")

### 1.1 Multi-Entity Foundation

**The structural gate everything else in Tier 1 depends on.** The
business now spans two legally distinct entities that share operational
ownership but must never share a tax return, a VAT quarter, or an
invoice sequence. Every subsequent Tier 1 feature assumes `entity_id`
already exists on account configs, contracts, invoices, and the
obligation registry.

**Why seed data lands in this feature, not as a tail-end section**

Without seeded entity rows, contracts can't FK an issuer, invoices
can't pick a PDF template, the dashboard has nothing to group by, and
there is no way to exercise jurisdiction-scoped tax queries in tests.
`autonize-it/company.csv` is committed as part of this feature's first
PR, not its last.

**Schema — `autonize-it/company.csv`**

```
id, legal_name, trading_name, kind (ltd | fzco | sole_trader | other),
jurisdiction (UK | UAE), regulator,
company_number, vat_number,                 -- UK-shaped identifiers
license_number, registration_number,        -- UAE-shaped identifiers
formation_date, address,
currency,
bank_sort_code, bank_account_number,        -- GBP bank details
iban, swift_bic,                            -- AED bank details
email,
logo_path,
accountant_name, accountant_email,
ct_registered, qfzp_elected,                -- UAE CT flags (UK row ignores)
vat_registered,                             -- applies to both, different thresholds
active, updated_at
```

Asymmetric columns deliberately: `company_number` + `vat_number` apply
to the UK row; `license_number` + `registration_number` + `iban` +
`swift_bic` apply to the FZCO row; `ct_registered` + `qfzp_elected`
only gate UAE CT obligations. All jurisdiction-specific columns are
nullable so a single schema handles both.

**Seed data — both rows committed at ship time**

| column | UK entity (row 1) | UAE entity (row 2) |
|---|---|---|
| `id` | `autonize-it-ltd` | `autonize-it-fzco` |
| `legal_name` | Autonize IT Limited | Autonize IT Software Development – FZCO |
| `trading_name` | Autonize IT Ltd | Autonize IT FZCO |
| `kind` | `ltd` | `fzco` |
| `jurisdiction` | UK | UAE |
| `regulator` | Companies House | IFZA (International Free Zone Authority) |
| `company_number` | 08842112 | *(null)* |
| `vat_number` | 292 1465 96 | *(null)* |
| `license_number` | *(null)* | 73348 |
| `registration_number` | *(null)* | 71347 |
| `formation_date` | *(TBC — capture from Companies House)* | 2025-11-04 |
| `address` | 53 Heath Park Road, Romford, RM2 5UL | DSO-IFZA, IFZA Properties, Dubai Silicon Oasis, Dubai, UAE |
| `currency` | GBP | AED |
| `bank_sort_code` | 20-25-19 | *(null)* |
| `bank_account_number` | 63648923 | *(null)* |
| `iban` | *(null)* | *(TBC — Emirates Islamic)* |
| `swift_bic` | *(null)* | *(TBC — Emirates Islamic)* |
| `email` | dmorrison@autonize-it.com | dmorrison@autonize-it.com |
| `logo_path` | `autonize-it/logo.svg` | `autonize-it/logo.svg` |
| `accountant_name` | *(TBC)* | *(TBC)* |
| `accountant_email` | *(TBC)* | *(TBC)* |
| `ct_registered` | `true` | *(TBC)* |
| `qfzp_elected` | *(n/a)* | *(TBC)* |
| `vat_registered` | `true` | `false` (per La Fosse self-bill agreement, FZCO VAT = N/A) |
| `active` | `true` | `true` |

Every `TBC` is preserved verbatim in the seed file so the Warnings
Engine (1.8) can flag them as unfilled data until resolved.

**Code changes — `server/types.ts`**

- `ACCOUNT_CONFIG` entries gain `entityId: 'autonize-it-ltd' |
  'autonize-it-fzco' | null` (personal accounts = `null`).
  - Business mapping: `barclays-current`, `barclays-savings`,
    `capital-on-tap`, `barclaycard` → `autonize-it-ltd`;
    `emirates-islamic` → `autonize-it-fzco`.
  - Personal: `natwest`, `natwest-savings`, `monzo-joint`,
    `santander-everyday` → `null`.
- `emirates-islamic`: `type` changes from `savings` to `current` (it is
  an operational current account now, not a parked AED reserve).
- `BusinessTaxConfig` restructures from two booleans into a
  jurisdiction-scoped shape:

  ```
  BusinessTaxConfig {
    entityId: 'autonize-it-ltd' | 'autonize-it-fzco'
    jurisdiction: 'UK' | 'UAE'
    vat: { applicable: boolean, rate: number, registered: boolean }
    corpTax: { applicable: boolean, qualifyingFreeZone: boolean }
  }
  ```

- `isCrossAccountBusinessToBusinessTransfer()` updates: returns
  `false` for pairs that span entity IDs; the transaction is instead
  classified via a new helper
  `classifyInterCompanyMovement(from, to) → 'within-entity' |
  'inter-company-unclassified'`. Inter-company movements flow through
  the Warnings Engine (1.8) rather than silently netting out.

**Code changes — `server/config/tax-rules.ts` (new)**

Single source of truth for tax rules keyed by `(jurisdiction, fy)`:

- UK entries: VAT 20% standard, CT 19% small-profits / 25% main /
  marginal relief band (existing registry already models this; tax-
  rules.ts becomes the jurisdiction-aware wrapper).
- UAE entries: VAT 5% (registration-gated), CT 0% QFZP qualifying /
  9% above AED 375k non-qualifying (QFZP election-gated). Threshold
  constants: `UAE_VAT_VOLUNTARY_AED = 187_500`,
  `UAE_VAT_MANDATORY_AED = 375_000`, `UAE_CT_SMALL_BUSINESS_AED =
  375_000`.

**Code changes — `server/db/utils/tax-account-filter.ts`**

Both `buildVatAccountFilter()` and `buildCorpTaxAccountFilter()` gain
an `entityId` parameter. Default to UK Ltd when omitted (backward-
compatible for existing call sites). Callers updated to pass the
entity derived from the dashboard's entity-scope toggle or from the
obligation row's own `entity_id`.

**Dashboard UI — `public/src/modules/dashboard.ts`**

- Entity scope selector in the header: **All · UK Ltd · UAE FZCO**.
  Defaults to All. Selection persists in session storage.
- Tax-liabilities panel splits when an entity-specific scope is
  active: UK panel shows VAT + CT in GBP; UAE panel shows CT (once
  registered) in AED with GBP-equivalent in a muted secondary line.

**Migration order — MUST be in this sequence**

1. Land `company.csv` seed + `entity_id` on `ACCOUNT_CONFIG` +
   jurisdiction-scoped tax-account-filter helpers, all together,
   behind their regression tests.
2. Only **after** step 1 is green, flip `emirates-islamic`'s
   `BusinessTaxConfig` from legacy booleans to the new
   jurisdiction-scoped shape with `jurisdiction: 'UAE'`, `vat.registered:
   false`, `corpTax.applicable: true, qualifyingFreeZone: TBC`.
3. Inverting this sequence silently pipes AED income into the UK VAT
   return — a hard regression that existing fixtures do not currently
   guard against. The new tests in step 1 close that gap.

**Regression tests — land alongside the config changes, green before flip**

- "UK VAT SQL query returns zero rows when the only matching
  transactions are on an AED-currency account, regardless of amount
  or narrative."
- "UK CT SQL query returns zero rows when the only matching
  transactions are on an `autonize-it-fzco` account."
- "UAE CT obligation auto-seeder emits zero rows until
  `company.csv.fzco.ct_registered = true` AND `qfzp_elected` is
  explicitly `true` or `false`."
- "`isCrossAccountBusinessToBusinessTransfer('barclays-current',
  'emirates-islamic')` returns `false`; the transaction pair is
  classified as `inter-company-unclassified` and raises a warning."
- "Dashboard entity selector set to UAE FZCO hides Barclays accounts
  and shows only Emirates Islamic."

**Warnings this feature emits into the Warnings Engine (1.8)**

- FZCO UAE CT registration status unknown — consult accountant.
- FZCO UAE VAT voluntary threshold crossed (AED 187.5k trailing 12m).
- FZCO UAE VAT mandatory threshold crossed (AED 375k trailing 12m).
- IFZA license renewal within 60 days (annual, license 73348).
- Inter-company money movement requires classification (loan /
  capital contribution / inter-company service fee).
- `autonize-it/company.csv` has any `TBC` field still populated.

**Non-goals (deferred to later tiers or explicit accountant territory)**

- Live UAE CT obligation rows — blocked on QFZP election answer.
- Live UAE VAT obligation rows — blocked on UAE VAT registration,
  which is not in place per the La Fosse self-bill agreement.
- UAE Economic Substance Regulations annual notification — Tier 3
  if FZCO's activity profile triggers it.
- Transfer pricing calculations for inter-company service fees — Tier
  3, accountant-driven.
- Controlled Foreign Company (CFC) interactions with UK personal
  tax for a UK-resident director of a UAE entity — strictly
  accountant territory; not app scope.

### 1.2 Clients, Contracts & Renewals

**Not a CRM. A structural anchor for every income-side calculation
downstream.** Today the app sees income only as bank deposits with
narrative strings. It has no concept of *who* is paying, *via which
route*, *under which contract generation*, or *when that generation
ends*. That invisibility is what lets a contract wind down in 30 days
with the forecast still showing green.

**Shape of the real-world data (both shapes are first-class)**

Most engagements are **agency-mediated**: a recruitment agency (e.g.
La Fosse) is the payer and self-bill issuer; the end client (e.g. The
Edwin Group) is where the work actually happens and where day-to-day
comms go. Some are **direct**: no agency, the client pays directly
(Delta Capita). The schema must serve both without forcing one into
the shape of the other.

**Template routing derived from `kind`**

| Template | `kind = direct` (Delta Capita) | `kind = agency` (La Fosse / Edwin) |
|---|---|---|
| Leave / sickness / time-off notice | primary contact | **end-client contact** (agency silent) |
| Invoice cover note | primary contact | **end-client contact** |
| Renewal discussion | n/a — client handles direct | **agency primary contact** (end client not copied) |
| Timesheet submission | n/a (supplier-issues invoices) | **agency primary contact** |

The routing engine is a pure function of `(template_kind,
client.kind, client.*_contact_*)`. Unit-tested exhaustively.

**Schema — `clients/clients.csv`**

```
id, legal_name, trading_name, kind (direct | agency),
vat_number, billing_address,

-- contacts (primary / secondary / HR / accounts are all at
-- client-facing level; for agency kind these are the AGENCY's
-- contacts, not the end-client's)
primary_contact_name, primary_contact_email,
secondary_contact_name, secondary_contact_email,
hr_contact_name, hr_contact_email,
accounts_contact_name, accounts_contact_email,
cc_emails,                                  -- comma-separated catch-all

-- end-client block (nullable; only populated when kind=agency)
end_client_legal_name, end_client_address,
end_client_primary_contact_name, end_client_primary_contact_email,
end_client_secondary_contact_name, end_client_secondary_contact_email,

-- operational
holiday_system_url,                         -- external portal, if any
client_assigned_email,                      -- e.g. david.morrison@ext.deltacapita.com

-- template paths (markdown files with {{handlebars}} variables)
leave_template_path,
sickness_template_path,
invoice_cover_template_path,
renewal_template_path,                      -- only used when kind=agency
timesheet_template_path,                    -- only used when kind=agency

active, updated_at
```

**Schema — `clients/contracts.csv`**

Time-bounded per renewal — the same payer can hold multiple contract
rows across entities over time. The current La Fosse/Edwin renewal is
one row with `issuing_entity_id = autonize-it-fzco`; earlier La Fosse
renewals that paid into Barclays (if back-seeded later) are separate
rows with `issuing_entity_id = autonize-it-ltd`.

```
id, client_id,
issuing_entity_id,                           -- FK to company.csv
type (master | sow | renewal | single),
reference,                                   -- human id (e.g. DMORRISON02, LF-2026-03)
start_date, end_date,
extended_hire_end_date,                      -- optional extension window

-- working pattern: seven booleans, not a string enum
works_monday, works_tuesday, works_wednesday,
works_thursday, works_friday, works_saturday, works_sunday,

-- commercial terms
day_rate, day_rate_currency,                 -- rate CCY may differ from entity default
invoice_currency,                            -- invoice-denominated CCY
invoice_cadence (weekly | monthly),
invoice_mechanism (supplier-issued | self-bill),
payment_terms_days,

-- notice / renewal
company_notice_weeks, supplier_notice_weeks,
renewal_warning_days,                        -- default 30

-- contextual
job_title, job_description, work_location,
conduct_regs (opted-in | opted-out | n-a),
engagement_tax_status (outside-ir35 | inside-ir35 | n-a-non-uk-supplier),
jurisdiction,                                -- governing law

-- provenance
signed_at, docusign_envelope,

active, updated_at
```

Seven boolean `works_*` columns rather than a free-text pattern —
flexible enough for Mon–Fri, four-day weeks, weekends-only
consulting, anything. Default at seed time is `works_monday..
works_friday = true`, `works_saturday = works_sunday = false`.

**Renewals — first-class, not an afterthought**

- Each contract's `end_date` auto-seeds a `deadlines/deadlines.csv`
  entry at `end_date − renewal_warning_days` with `category =
  contract-renewal`.
- Seeded deadlines flow into the existing Tier 0 calendar via the
  shipped `buildDeadlineFeed()` — no new rendering code.
- Renewal-warning window is per-contract (`renewal_warning_days`,
  default 30).
- When a new row with a later `start_date` is added for the same
  `client_id + issuing_entity_id`, the prior row's `active` flips to
  `false` and its renewal deadline is archived (not deleted — history
  matters for payer↔contract matching on historical transactions).

**Payment matcher update — timeline-aware**

- Match rule: `(payer_name heuristic matches) AND (transaction.date
  ∈ [contract.start_date, contract.end_date OR
  contract.extended_hire_end_date]) AND
  (transaction.account.entity_id = contract.issuing_entity_id)`.
- A La Fosse payment landing on Barclays in **March 2026 or later** =
  anomaly → warn "payment from known payer outside any active
  contract window; expected on FZCO".
- A La Fosse payment landing on Emirates Islamic **before March
  2026** = anomaly → warn "payment predates contract start".
- Both are warnings, not hard errors — late payments for prior
  contracts and advance payments for new contracts are legitimate
  and require manual classification.

**Template rendering engine**

- Markdown files with `{{handlebars}}` interpolation:
  `{{client.legal_name}}`, `{{end_client.legal_name}}`,
  `{{contract.start_date}}`, `{{contract.end_date}}`, `{{leave.start}}`,
  `{{leave.end}}`, `{{leave.days_count}}`, `{{consultant.email}}`.
- Recipient resolution is a pure function of `(template_kind,
  client.kind, contact fields)` — see the routing table above.
- Previewable in the UI before send; delivery itself lives in 2.3
  (Alert Queue delivery adaptors).

**Seed data — 2 client rows + 3 contract rows committed with this feature**

`clients/clients.csv`

| column | Row 1 — Delta Capita | Row 2 — La Fosse |
|---|---|---|
| `id` | `delta-capita` | `la-fosse` |
| `legal_name` | Delta Capita Ltd | La Fosse Associates Limited |
| `trading_name` | Delta Capita | La Fosse |
| `kind` | `direct` | `agency` |
| `vat_number` | *(TBC)* | 360 0265 37 |
| `billing_address` | 2nd Floor, 40 Bank Street, Canary Wharf, London, E14 5NR | 1st Floor, 11-19 Artillery Row, London, SW1P 1RT |
| `primary_contact_name` | Lily Lovegrove-Saville | *(TBC — La Fosse account manager)* |
| `primary_contact_email` | lily.lovegrove@deltacapita.com | *(TBC)* |
| `secondary_contact_name` | Philip Coleman | *(TBC)* |
| `secondary_contact_email` | philip.coleman@deltacapita.com | *(TBC)* |
| `hr_contact_name` | William Swift | *(n/a)* |
| `hr_contact_email` | william.swift@deltacapita.com | *(n/a)* |
| `cc_emails` | hrandrecruitment@deltacapita.com, dan.hedley@deltacapita.com | *(n/a)* |
| `end_client_legal_name` | *(n/a — direct)* | The Edwin Group Ltd |
| `end_client_address` | *(n/a)* | First Floor (South), Cathedral Buildings, Dean Street, Newcastle Upon Tyne, NE1 1PG |
| `end_client_primary_contact_name` | *(n/a)* | Aidan Gray |
| `end_client_primary_contact_email` | *(n/a)* | *(TBC)* |
| `holiday_system_url` | *(TBC — whichever DC portal logs contractor leave)* | *(n/a — no external portal; leave routed via email to Aidan Gray)* |
| `client_assigned_email` | david.morrison@ext.deltacapita.com | *(TBC if one exists for Edwin)* |
| `leave_template_path` | `clients/templates/delta-capita/leave.md` | `clients/templates/la-fosse/leave.md` |
| `sickness_template_path` | `clients/templates/delta-capita/sickness.md` | `clients/templates/la-fosse/sickness.md` |
| `invoice_cover_template_path` | `clients/templates/delta-capita/invoice-cover.md` | *(n/a — self-bill)* |
| `renewal_template_path` | *(n/a — direct)* | `clients/templates/la-fosse/renewal.md` |
| `timesheet_template_path` | *(n/a — supplier-issues)* | `clients/templates/la-fosse/timesheet.md` |
| `active` | `true` | `true` |

`clients/contracts.csv` (three rows)

| column | Row 1 — DC master | Row 2 — DC current SOW | Row 3 — La Fosse current |
|---|---|---|---|
| `id` | `dc-master-2025` | `dc-sow-dmorrison02` | `lf-2026-mar` |
| `client_id` | `delta-capita` | `delta-capita` | `la-fosse` |
| `issuing_entity_id` | `autonize-it-ltd` | `autonize-it-ltd` | `autonize-it-fzco` |
| `type` | `master` | `sow` | `renewal` |
| `reference` | DC-Contractor Contract | DMORRISON02 | La Fosse PSC Candidate Contract (Opt-Out) |
| `start_date` | 2025-06-23 | 2026-01-01 | 2026-03-02 |
| `end_date` | *(open — governed by SOWs)* | 2026-04-30 | 2026-04-30 |
| `extended_hire_end_date` | *(n/a)* | *(n/a)* | 2026-06-30 |
| `works_monday..friday` | *(n/a — master)* | all `true` | all `true` |
| `works_saturday/sunday` | *(n/a)* | `false` | `false` |
| `day_rate` | *(n/a)* | 550.00 | 500.00 |
| `day_rate_currency` | GBP | GBP | GBP |
| `invoice_currency` | GBP | GBP | GBP *(deposits AED on Emirates Islamic)* |
| `invoice_cadence` | *(n/a)* | `monthly` | `weekly` |
| `invoice_mechanism` | *(n/a)* | `supplier-issued` | `self-bill` |
| `payment_terms_days` | *(n/a)* | 30 | 30 |
| `company_notice_weeks` | 4 | 4 | 2 |
| `supplier_notice_weeks` | 4 | 4 | 2 |
| `renewal_warning_days` | 30 | 30 | 30 |
| `job_title` | *(n/a)* | Full Stack Developer | Full Stack Engineer |
| `work_location` | *(n/a)* | Remote + occasional London | Remote + occasional London / Sheffield / Newcastle |
| `conduct_regs` | *(n/a)* | opted-in | opted-out |
| `engagement_tax_status` | *(n/a)* | outside-ir35 | n-a-non-uk-supplier |
| `jurisdiction` | England | England | England |
| `signed_at` | 2025-06-23 | 2025-12-22 | 2026-04-02 |
| `docusign_envelope` | `EE549B3A-2693-487E-89EE-C22C27F43FCC` | `FFD1FFDF-734E-49E5-A762-A7676D39ABF8` | *(n/a — PDF only)* |

Notes on seed data:

- La Fosse's `primary_contact_*` is `TBC` — the user will fill in
  their account manager's name and email after ship. Until filled,
  the Warnings Engine (1.8) flags the contract as having unresolved
  template recipients.
- Aidan Gray's email at Edwin is `TBC` for the same reason.
- A historical placeholder row `dc-sow-2025` (`reference =
  "unattached"`, `start_date = 2025-06-23`, `end_date =
  2025-12-31`) can be added as a fourth contract row to give
  invoices DC-001..DC-006 a contract FK to hang off — recommended
  at ship time; prior SOW document can be attached later.
- Historical La Fosse renewals (paying into Barclays prior to March
  2026) are **not** seeded in 1.2. Documented as a Tier 3 data-
  quality cleanup: when those contracts are located, back-seeding
  them rebuilds prior-year payment↔contract matching retroactively.

**Acceptance criteria**

- Clients page lists both clients with their `kind` discriminator
  visible; La Fosse row shows Edwin Group as end client in a nested
  block.
- The La Fosse contract end date (2026-04-30) surfaces as a red
  item on the calendar **on first run of this feature** (currently
  9 days away). Expected behaviour — documented in release notes
  so it is not mistaken for a bug.
- Unit test: leave template for Delta Capita resolves recipients to
  `lily.lovegrove@deltacapita.com` primary, with Philip + Will + Dan
  on CC; La Fosse is not referenced.
- Unit test: leave template for La Fosse/Edwin contract resolves
  recipients to `end_client_primary_contact_email` (Aidan Gray); La
  Fosse contacts are excluded entirely.
- Unit test: renewal template for La Fosse resolves to La Fosse
  `primary_contact_email`; Edwin is excluded entirely.
- Unit test: applying a renewal template to a `direct` client row
  raises a structured error (`DirectClientHasNoAgencyRenewalFlow`);
  caller is expected to handle.
- Payment-matcher test: a Barclays deposit of £10k with narrative
  matching La Fosse, dated 2026-05-15, emits the anomaly warning
  rather than silently attributing to any contract.

**Non-goals**

- Actual email sending — lives in 2.3 (Alert Queue delivery).
- External holiday-system integration (e.g. DC's contractor
  portal) — stays as `holiday_system_url` + a manual-cleared flag on
  the leave entry.
- CRM features (activity log, pipeline, notes) — explicitly out of
  scope.
- Auto-fill of end-client contacts from public company registries —
  Tier 3.

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
invoice_date,
period_start, period_end, days_billed,

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
  dc-sow-dmorrison02, period = 2026-04-01..2026-04-30, days = 20)`
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
type (holiday | sick | unpaid | bank-holiday | public-holiday | company-closure),
paid,                                        -- boolean; bank-holidays often paid, unpaid rarely
notes,
external_logged,                             -- cleared when user has logged in client's portal
created_at, updated_at
```

- Working days are **derived**: everything the contract's
  `works_*` booleans cover, minus any leave row for the same date,
  minus automatic public-holiday rows.
- Ledger is leave-only. "Working" is the default, not a row. This
  halves the row count versus storing every day.
- Jurisdiction-aware public holidays: UK public holidays auto-apply
  to contracts with `issuing_entity_id = autonize-it-ltd`; UAE
  public holidays auto-apply to contracts with `issuing_entity_id =
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
  unpaidLeave(period, contract)`. No recall-from-memory.
- **Self-bill reconciliation** (1.3 reconciler): parsed La Fosse
  self-bill's `days` field compared against ledger-derived
  `days_worked`; mismatch → warning in 1.8.
- **Forecast accrual** (1.5): `accrued_to_date(contract) = day_rate
  × workedDays_since_last_invoice`. Real-time per contract per
  entity, not invoice-lagged.
- **Solvency-warning input** (1.8): scheduled unpaid leave
  immediately shows up as a per-entity dip in projected income.
  Log six unpaid days in August for the FZCO contract and the
  August reservoir gap for *next FZCO invoice* widens
  automatically.

**Seed data — implied leave rows reverse-computed from DC invoices**

For each DC-invoice month, `expected_working_days = Mon-Fri in
month − UK bank holidays`; `implied_leave = expected − invoiced_days`.
These become seed rows in `working-days/leave.csv` with `type =
holiday` (safe default; user can recategorise to sick / unpaid
individually after ship).

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
- Logging 3 unpaid days for `lf-2026-mar` contract reduces FZCO
  projected income by `3 × £500 = £1,500` for the affected month.
- UK public holidays (8 per calendar year) auto-excluded from DC
  working days; UAE public holidays auto-excluded from La Fosse
  working days. Public-holiday rows present in the ledger but
  `paid = true`, `external_logged = true` by default.

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

**Deferred until after 1.1 ships.** The multi-entity foundation (1.1)
owns the authoritative `accounts → entity_id` mapping that this feature
depends on to route per-entity credentials. 3.5 can ship any time after
1.1 lands; it has no upstream dependency on the forecasting stack
(1.2 – 1.9).

---

### 3.6 Canonical Config Registry Pattern (architecture)

**Problem.** The `entityId` dropdown that shipped to the dashboard and
did nothing was a symptom, not a bug. Config logic was fragmented across
six places: `ACCOUNT_CONFIG` literal in `server/types.ts`, inline
`ACCOUNTS.filter(a => ACCOUNT_CONFIG[a].category === 'business')`
scattered across repositories, `getVatApplicableAccounts` /
`getCorpTaxApplicableAccounts` helpers, a parallel `EntityScopedFilterOpts`
type that threaded `entityId` through filters that didn't use it,
`buildVatAccountFilter` / `buildCorpTaxAccountFilter` with their own gate
logic, and a `DashboardFilters.entityId` field consumed by nobody. Six
subtly different answers to one question — and no programmatic way to
detect that a capability had lost all its consumers. See
[docs/config-registries.md](docs/config-registries.md) for the full
architectural rationale.

**Shape of the fix.** Every set-wise configuration (accounts, people,
payees, merchants, payroll, company, transaction-overrides) is migrated
to a standard `server/domain/<name>/` module:

```
server/domain/<name>/
  schema.ts       Zod schema + derived TS types (single source of truth for shape)
  data.ts         the raw literal / CSV loader
  registry.ts     build function + precomputed indexes + memoization via createRegistry
  queries.ts      pure public query functions over the registry indexes
  fixtures.ts     makeTest<Name>Registry for tests, routed through production build
  index.ts        barrel re-exports
  *.test.ts       schema / gates / invariants / lifecycle / queries / manifest
```

Plus shared primitives under `server/domain/_shared/`:
`create-registry.ts` (memoization + invalidation + test reset),
`index-builders.ts` (`groupBy` / `indexBy` / `filterToIndex` /
`mapToIndex`), `fixture-builder.ts`, and `manifest-test.ts` — the
capability-drift detector that asserts every index in a registry has at
least one documented live consumer, so a dead dropdown can never silently
ship again.

**Status — Phase A complete for `accounts`:**

- ✅ **A0** — shared primitives built + tested (37/37 passing)
- ✅ **A1** — `docs/config-registries.md` written (pattern + test template + naming rule)
- ✅ **A2** — `server/domain/accounts/` built (97/97 tests passing)
- ✅ **A2b** — pre-migration parity snapshot locked (17/17 OLD vs NEW byte-for-byte)
- ✅ **A3** — parallel idioms killed: `isBusinessConfig`, `getVatApplicableAccounts`,
  `getCorpTaxApplicableAccounts`, `EntityScopedFilterOpts` deleted from
  `server/types.ts`; `buildVatAccountFilter` + `buildCorpTaxAccountFilter`
  collapsed into a single generic `buildAccountInFilter(accounts)` driven by
  the new registry indexes; `DashboardFilters.entityId` removed (it had no
  consumer); every dependent test file rewritten against the new API.
- ✅ **A4** — every remaining consumer migrated to
  `server/domain/accounts/`. `server/types.ts` shrank from 503 lines to 170:
  `ACCOUNT_CONFIG` literal, `getAccountConfig`, `isValidAccountName`,
  `validateAccount`, `getBusinessPaymentAccounts`, `getAccountsByEntity`,
  `getEntityIdForAccount`, `getPersonalPaymentAccounts`,
  `getBusinessAndPersonalPaymentAccounts`, `isCreditCard`,
  `isBusinessAccount`, `isCrossAccountBusinessToBusinessTransfer`, plus all
  account-related interfaces (`AccountType`, `AccountCategory`, `VatConfig`,
  `CorpTaxConfig`, `BusinessTaxConfig`, `BusinessAccountConfig`,
  `PersonalAccountConfig`, `AccountConfig`) all deleted. The 17 files that
  imported any of them — `transactions`, `debts`, `budgets`, `sa-auto-seed`,
  `ct-auto-seed`, `vat-auto-seed`, `query-builders`, `tax`, `parsers/index`,
  `dashboard`, `statements`, `expenses`, `budgets` (route), `tax` (route),
  `recurring-pipeline`, `ad-hoc-merchant-series`, `inter-company/pair-finder`,
  `warnings/fzco-income` — all now import from `server/domain/accounts/`.
  The legacy `server/types.test.ts` was deleted (coverage fully replicated
  by `queries.test.ts`, `migration-parity.test.ts`, and
  `registry.invariants.test.ts`).
- ✅ **A5** — `registry.manifest.test.ts` tightened from a placeholder into
  a real consumer manifest. Every one of the 13 indexes
  (`business`, `personal`, `byEntity`, `vatApplicable`,
  `vatApplicableByEntity`, `corpTaxApplicable`, `corpTaxApplicableByEntity`,
  `outgoingPaymentsCapable`, `businessOutgoingPayments`,
  `personalOutgoingPayments`, `excludeTransfersFromIncome`,
  `showTaxLiabilities`, `creditCards`) is now mapped to the real files +
  functions that consume it, so adding a new index without wiring a caller
  will fail this test. Indexes documented as test-only (`excludeTransfersFromIncome`,
  `showTaxLiabilities`) are honestly flagged — future production use should
  promote them; if none emerges they are the next cleanup candidates.
- ✅ **A6** — `tsc --noEmit` clean, **106 files / 1774 tests passing**
  (down from 107 files after deleting the redundant `server/types.test.ts`;
  no net regression — its 22 tests are fully absorbed by the domain
  test suite). Live smoke: `GET /api/dashboard/accounts`,
  `/api/dashboard/summary`, `/api/statements/accounts`,
  `/api/tax/vat-payments` all return 200 against the running dev server.
  **Phase A is complete for `accounts` — ready for Phase B.**

**Status — Phase B complete (all six registries migrated):**

- ✅ **B1** — `server/config/people.ts` → `server/domain/people/` with
  `byId` / `directors` / `saFilers` / `aliasRegexes` indexes. Every
  consumer (`sa-auto-seed`, `sa-estimator`, `merchant-registry`, payees)
  redirected; legacy file deleted.
- ✅ **B2** — `server/config/payees.ts` split: `Director` folded into
  `people.indexes.directors`; HMRC narrative patterns
  (`HMRC_PATTERNS`, `HMRC_NARRATIVE_PATTERNS`, `buildHmrcNarrativeCaseSql`)
  relocated to `server/domain/payees/hmrc-patterns.ts`. All tax-auto-seed
  consumers (`tax` repo + route, `vat-auto-seed`, `sa-auto-seed`,
  `ct-auto-seed`, `sa-estimator`) rewired.
- ✅ **B3** — `server/utils/merchant-registry.ts` →
  `server/domain/merchants/` with `patterns` / `byCategory` /
  `byDisplayName` indexes + full canonical test template; `categorizer`
  and `normalizeMerchant` call sites migrated.
- ✅ **B4** — `server/config/payroll.ts` → `server/domain/payroll/`
  (derived registry joining `payroll`-category obligations with directors
  from the people registry). Indexes: `entries`, `byAccount`,
  `byPersonAccount`, `directorsById`. Full testing template landed;
  legacy file + test deleted.
- ✅ **B5** — `server/domain/company/registry.ts` refactored onto
  `createRegistry`. Methods (`getById`, `listByJurisdiction`,
  `listEntityIds`) replaced with named indexes (`byId`, `byJurisdiction`,
  `active`) + query functions (`allCompanies`, `companyById`,
  `companiesByJurisdiction`, `activeCompanies`). Routes `company.ts` and
  `warnings.ts` migrated to the new query surface.
- ✅ **B6** — `server/domain/transaction-overrides/` brought onto
  `createRegistry` with `byHash` index, mutable-directory handling
  documented in the pattern doc, and its manifest test landed.
  Four consumers (`categorizer`, `payroll/queries`,
  `inter-company/movements-response`, `warnings/inter-company-count`)
  migrated from `getOverrideRegistry().get(hash)` to the
  `lookupOverride(hash)` query.
- ✅ **B7** — `docs/config-registries.md` closed with the full registry
  directory table: location, purpose, and the exhaustive index list for
  all seven canonical registries (`accounts`, `people`, `payees`,
  `merchants`, `payroll`, `company`, `transaction-overrides`), plus an
  explicit carve-out for the one not-yet-migrated legacy registry
  (`obligations`).

**Status — Phase C complete (enforcement):**

- ✅ **C1** — Every canonical registry ships a `registry.manifest.test.ts`
  built on the shared `assertManifestConsumers` helper. Added
  `server/domain/_shared/all-registries.manifest.test.ts`: a repo-wide
  sweep that auto-discovers every directory under `server/domain/`
  containing a `registry.ts` and asserts it ships a manifest test.
  Non-registry-shaped directories (`_shared`, `deadlines`,
  `inter-company`, `payees`, `warnings`) are explicitly listed;
  the single legacy exception (`obligations`, not yet on `createRegistry`)
  is pinned in an exemption list so that removing it from the list
  instantly enforces the contract. A new registry cannot merge without
  a manifest test.
- ✅ **C2** — UI-control code-review checklist added to
  `docs/config-registries.md`. The rule — _"a UI control must change at
  least one visible field in the response via a path not already
  expressed by existing config; if not, the control shouldn't exist"_ —
  is now backed by a concrete six-item reviewer checklist (name the
  field it changes, trace the path, check for parallel vocabulary,
  require a manifest consumer, require a test that fails without the
  control, name the question). The Entity dropdown post-mortem is the
  worked example.

**Verification.** `tsc --noEmit` clean, **133 files / 1937 tests passing**,
including the six canonical registry test templates, the new
registry-sweep test, and the manifest tests for every registry. Live API
smoke (`/api/dashboard/summary`, `/api/warnings/*`, `/api/statements/accounts`,
`/api/tax/vat-payments`) all 200. The pattern is fully in place; the only
deferred item is **C3** (end-to-end API snapshot test for
`/api/dashboard/summary` + `/api/warnings/*`), tracked separately.

**Why this is worth the churn.** Every Tier 1 feature lands faster on
this foundation: multi-entity scoping (1.1) is already partially
expressed via the `accounts` registry's `byEntity` index; contracts and
invoices (1.2 / 1.3) will route through `clients` / `contracts`
registries in the same shape; the Warnings Engine (1.8) becomes a
reduction over named registry indexes rather than ad-hoc scans. The
manifest-test contract means new features cannot ship orphaned
capabilities, full stop.

---

## Dependency Chain

```
Tier 0 (Certainty) ✅      Tier 1 (Projection)                     Tier 2 (Agent)

Obligations + Deadlines    Multi-Entity Foundation (1.1) ─┐
(shipped)                  Clients + Contracts (1.2) ─────┼─→ Invoicing (1.3) ─→ Working-Days Ledger (1.4) ─┐
                           Renewals (1.2) ────────────────┘                                                  ├─→ Forecast (1.5) ─→ Snapshot (2.1)
                                                                                                             │                    Confidence Score (2.2)
                                                                                                             │                    (reduction over 1.8)
                                                                                                             ├─→ Warnings (1.8) ─→ Alert Queue (2.3)
                                                                                                             │                    (delivery)
                                                                                                             │                    WhatsApp (2.4)
                                                                                                             ├─→ Worst Case (1.6)
                                                                                                             ├─→ Income Composition (1.7)
                                                                                                             └─→ Debt Strategy (1.9)
```

**Multi-Entity Foundation is the gate.** Nothing income-side can be
correctly scoped until UK and UAE books are separable at the query
layer. Once 1.1 lands, every downstream feature inherits entity
awareness for free.

**Clients + Contracts → Invoicing → Working-Days Ledger → Forecast →
Warnings** is the main income-side backbone. Invoicing depends on
contracts (every invoice FK's a contract); the ledger depends on
both (fills in day counts); the forecast depends on the ledger for
deterministic accrual; the warnings engine reduces over everything.

**The Warnings Engine (1.8) gates most of Tier 2.** Both the
Confidence Score and the Alert Queue become reductions over its
output, not independent calculations, so there is exactly one place
where "is this user safe?" is decided.

---

## Suggested Build Order

1. **Multi-Entity Foundation (1.1)** — `company.csv` both rows,
   `entity_id` on `ACCOUNT_CONFIG`, jurisdiction-scoped
   tax-account-filter, Emirates Islamic reclassified as
   current/operational, dashboard entity toggle. Regression tests
   green before any Emirates Islamic tax flag flips.
2. **Clients, Contracts & Renewals (1.2)** — `clients.csv` and
   `contracts.csv` with DC + La Fosse/Edwin seed rows; template
   routing engine; renewal deadlines wired into the Tier 0
   calendar; payment-matcher updated to be timeline + entity
   aware.
3. **Invoicing System (1.3)** — outbound PDF generator for
   supplier-issued (DC shape) AND inbound parser for self-bill (La
   Fosse shape) in the same release; per-entity invoice sequences;
   FX snapshots at issue and payment; 10 DC historical rows seeded
   with their documented warnings; `pdfmake` + `sharp` wiring.
4. **Working-Days Ledger (1.4)** — `leave.csv` + jurisdiction-
   aware public holidays + per-month UI + reconciliation with 1.3
   invoice day counts. Seed the reverse-computed DC leave rows.
5. **Cash Flow Forecast (1.5)** — the single biggest behaviour
   change the app can make. Per entity, daily resolution.
6. **Solvency Warnings Engine (1.8)** — brought forward. Without it
   the forecast has no voice; with it, 2.2 and 2.3 collapse into
   thin reductions / delivery adaptors.
7. **Worst Case / Runway + formalised credit headroom (1.6)** —
   cheap once 1.5 is in.
8. **Income Composition & Diversification (1.7)** — three metrics
   (client concentration, active/passive ratio, time-independence
   ratio) plus the income-sources and income-goals registries.
   Trivial to wire for contract-shaped income once 1.2 ships; the
   non-contract registries are the real work. Emits into 1.8.
9. **Debt Strategy Advisor (1.9)** — rule-based recommendations on
   top of the existing debt table.
10. **Financial Snapshot (2.1)** + **Confidence Score (2.2)** — the
    agent's two core reads; 2.2 is a reduction over 1.8.
11. **Alert & Notification Queue (2.3)** — delivery path for 1.8.
12. **Net Worth Snapshots (3.1)** — entity-aware from day one.
13. **Multi-Currency extensions (3.2)** — whatever did not land in
    1.1 / 1.3.
14. **Historical Invoice Parser Fallbacks (3.3)** — OCR + inbound
    automation.
15. **WhatsApp / Chat Interface (2.4)** — delivery channel, ships
    last.

---

## One-Line Summary

> You don't need more analytics — you need a system that **guarantees** no obligation
> can exist, be missed, or go unnoticed, past or future.
