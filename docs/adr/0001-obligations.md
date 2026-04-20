# ADR 0001 — Obligations

Status: accepted
Date: 2026-04-20 (superseded: 2026-04-20 — simplification pass)

## Context

Before this decision, a user could declare the same real-world recurring
financial item in four different places, each with a different shape,
field name and recurrence enum:

| Source | Path | Shape | Recurrence | Currency |
|---|---|---|---|---|
| Fixed-bill overrides | `server/utils/fixed-bill-overrides.ts` | code constant | `monthly` only | `CurrencyCode` supported |
| Rental properties | `server/utils/rental-properties.ts` | code constant | `monthly` only | none |
| Payroll entries | `server/config/payroll.ts` | code constant | `monthly` only | none |
| Manual obligations | `obligations/manual-obligations.csv` | CSV + DB | `monthly \| quarterly \| annual \| one-off` | none |

The API contract carried two different enums for the same concept
(`RecurringFrequencySchema` — `monthly | annual`, and
`ObligationRecurrenceSchema` — `monthly | quarterly | annual | one-off`).
The field name was `frequency` on the fixed-expenses side and `recurrence`
on the obligations side. There was no shared registry and no
deduplication: the same real-world bill could appear on both Fixed
Expenses and the Obligations page with different values and no
cross-reference.

This plurality directly caused two wasted implementation attempts —
adding a new `FIXED_BILL_OVERRIDES` entry for a monthly AED payment and
adding an annual insurance bill that should have been routed to Fixed
Expenses but was silently hidden by a category whitelist. The codebase
offered no ubiquitous language for "declared recurring item", so each
new feature tended to fork another one.

## Decision

### 1. One canonical concept: `Obligation`

A single domain noun — **obligation** — encompasses every user-declared
recurring financial item, regardless of surface. An `Obligation` is a
discriminated union of `IncomingObligation` and `OutgoingObligation`;
each variant is further discriminated on `category`. Auto-seeded tax
obligations (VAT/SA/CT/TTP) emit the same row shape but live in their
own pipeline stage because their amount and date logic is tax-rule-
derived, not user-declared.

The naming preserves the distinction between:

- **`Obligation`** — the canonical domain concept (in-memory, the
  registry entry, the thing a CSV row declares).
- **`ObligationRow`** — the legacy `financial_obligations` table
  projection used by the Obligations tab's REST API. It is a projection
  of the subset of `OutgoingObligation` variants that surface on that
  tab, not a parallel concept.

### 2. Direction-split at the schema level

`Obligation` splits into two sibling schemas at the top:

- `IncomingObligation` — money we expect to receive (`rental-income`,
  future `dividend-income`, `salary-received`, etc).
- `OutgoingObligation` — money we expect to pay (`fixed-bill`,
  `subscription`, `payroll`, `insurance`, `tax-manual`).

Direction is encoded in the type, not a boolean field. Functions that
only apply to outgoings (e.g. "show on Obligations tab") refuse to
compile when called with incoming obligations.

### 3. One frequency enum, everywhere

`FrequencySchema = z.enum(['monthly', 'quarterly', 'annual', 'one-off'])`
replaces every previous recurrence/frequency enum. The field name is
`frequency` on every schema, DB column, CSV column and TS field. The
word `cadence` — considered during design — was rejected as more
ambiguous for a lay-user-facing CSV.

### 4. Zod-first with `z.infer` for the TS type

Schemas are declared in Zod; TS types are inferred via `z.infer`. This
matches every other shared schema in `shared/api-contracts.ts`, preserves
runtime validation at the CSV trust boundary (a typo in `obligations.csv`
becomes a parse error with a precise path, not an `undefined` deep in the
pipeline), and keeps TS-first ergonomics at consumer call sites via
discriminated-union narrowing.

#### Rejected alternatives

- **Classes implementing a common interface.** The categories have
  divergent *shape* (rental has `ownership`, payroll has
  `amountTolerance`, etc) but no divergent *behaviour* — all projection
  logic lives in pipeline functions. Classes would add N×M boilerplate
  (every new projector × every category) and break CSV round-trip.
  Discriminated unions + pure functions scale linearly.
- **Interfaces only, no runtime schema.** `z.infer` already yields a
  pure TS discriminated union; dropping Zod buys nothing but loses CSV
  validation.
- **Generate Zod from TS types.** Requires `ts-to-zod` / `typia` code
  generation the repo doesn't have; net complexity for a syntactic win.

### 5. Views own their routing; exhaustiveness via `assertNever`

Every consumer that filters `Obligation` / `IncomingObligation` /
`OutgoingObligation` by category **must** do so through a named filter
function exported from the view module, of the form:

```ts
function showOn{ViewName}(o: OutgoingObligation): boolean {
  switch (o.category) {
    case 'fixed-bill':   return true;
    // ...every category enumerated
    default:             return assertNever(o);
  }
}
```

- **Locality**: the routing decision lives next to the view consuming
  it. A developer reading the view sees the rule without navigating
  anywhere.
- **Exhaustiveness**: adding a new category to the schema triggers a TS
  compile error in every `switch` — the developer is pointed at every
  call site that must be updated.
- **No silent drops**: omitting a case is impossible.

Bare `o.category === 'x'` checks outside named filter functions are
banned by code review.

#### Rejected alternative: central `CATEGORY_SURFACE_MATRIX`

A single `Record<ObligationCategory, SurfaceFlags>` table was considered
and rejected. It gave exhaustiveness but created action-at-a-distance: a
dev debugging "why isn't insurance on Fixed Expenses?" would have to
know the matrix exists. The view-local filter approach preserves the
exhaustiveness guarantee while keeping the decision discoverable where
it's used. This rule caught a real bug during the simplification pass:
an earlier `FIXED_EXPENSES_OUTGOING` whitelist was silently excluding
`insurance`, so the annual Orient Insurance bill never surfaced. With
view-local filters this fails a fitness test at build time.

### 6. Registry-first for rental income (inverted bridge)

In the recurring pipeline, income transactions consult the obligations
registry **before** the string-heuristic categorizer. A matching
`rental-income` obligation drives both the category and display; the
string heuristic remains a fallback for undeclared rentals.

A boot-time invariant (`assertRentalMerchantsClassify`) asserts every
`rental-income` obligation's merchant also classifies to
`SPECIAL_CATEGORY.property` via the string heuristic. Other surfaces —
dashboard charts, budgeting, ad-hoc expense classification — still read
from the heuristic directly, so silent divergence between the two
sources is caught at boot.

### 7. Architectural fitness tests

Tests in `server/domain/obligations/routing.fitness.test.ts` import each
view's named filter and enumerate `IncomingObligationCategory` /
`OutgoingObligationCategory` values to assert invariants:

- Every obligation category is surfaced on at least one view.
- Every row in persistent config parses against the schema.
- Tax obligations are never surfaced on Fixed Expenses.
- Rental income is never surfaced on the Obligations tab.
- Every `rental-income` obligation merchant classifies as Property.

Invariants are audited as code, not as a config table or tribal
knowledge.

### 8. Persistence

One user-editable CSV: `obligations/obligations.csv`. Seed rows for
previously hardcoded configs (fixed-bill overrides, rental properties,
payroll entries) live in `obligations/obligations-seed.csv`, tracked in
git. The registry loader unions the seed with the user CSV; user rows
with the same `id` shadow seed rows.

The old `obligations/manual-obligations.csv` and `commitments/*` CSVs
were merged into `obligations/obligations.csv` / `obligations-seed.csv`.
Obligations that aren't declared (tax auto-seeded rows) continue to be
inserted into the DB directly by `sa-auto-seed`, `ct-auto-seed`,
`vat-auto-seed`, `hmrc-ttp-auto-seed`. Routing them through the
registry is a deferred follow-up.

### 9. Tax subtypes preserved

`tax-manual` obligations carry a `taxType` field
(`vat | corporation-tax | self-assessment | hmrc-ttp`) so the Obligations
tab REST projection round-trips losslessly. An earlier implementation
collapsed every tax subtype to `self-assessment`; this was a latent bug.

## Consequences

- Four declaration sources collapse to one. Adding a new recurring bill
  is a one-CSV-row change (no code).
- Two recurrence enums + two field names collapse to one (`frequency`).
- AED/GBP currency support is uniform on every surface, not just Fixed
  Expenses.
- Tax auto-seeders are unchanged conceptually but their insert shape
  aligns with `OutgoingObligation` so downstream projectors don't need
  a parallel code path.
- Adding a new category (e.g. `loan-repayment`) requires: one schema
  entry, updates to every `switch` in view filters (enforced by TS),
  and a fitness test update if the category should surface on a
  specific tab.
- The "where does category X appear?" audit is now a fitness test, not
  a reader's memory.

## Out of scope

- `DebtSchema` and the debts CSV — different lifecycle (opening
  balances, amortisation schedules).
- Merchant registry, transfer patterns, pass-through detection —
  categorisation concerns, not declaration.
- Category budget CSV — spending caps per category, orthogonal.
- The TTP auto-seeder's use of recurring-detector output — intentional
  cross-surface coupling, retained.
