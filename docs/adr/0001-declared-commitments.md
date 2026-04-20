# ADR 0001 — Declared commitments

Status: accepted  
Date: 2026-04-20

## Context

Across the codebase today a user can declare the same real-world recurring
financial commitment in four different places, each with a different shape,
field name and cadence enum:

| Source | Path | Shape | Cadence | Currency |
|---|---|---|---|---|
| Fixed-bill overrides | `server/utils/fixed-bill-overrides.ts` | code constant | `monthly` only | `CurrencyCode` supported |
| Rental properties | `server/utils/rental-properties.ts` | code constant | `monthly` only | none |
| Payroll entries | `server/config/payroll.ts` | code constant | `monthly` only | none |
| Manual obligations | `obligations/manual-obligations.csv` | CSV + DB | `monthly \| quarterly \| annual \| one-off` | none |

The API contract carries two different enums for the same concept:

- `RecurringFrequencySchema` / `ExpensesLineItemSchema.frequency` — `monthly | annual`
- `ObligationRecurrenceSchema` — `monthly | quarterly | annual | one-off`

The field name `frequency` is used on the fixed-expenses side; `recurrence` on
the obligations side. There is no shared registry and no deduplication: the
same real-world bill can appear on both Fixed Expenses and the Obligations
page with different cadence values and no cross-reference.

This plurality directly caused a wasted implementation attempt (adding a new
`FIXED_BILL_OVERRIDES` entry for an annual bill that would have been more
naturally modelled as a manual obligation, and vice versa). The codebase
offers no ubiquitous language for "declared recurring commitment", so each
new feature tends to fork another one.

## Decision

### 1. One canonical concept: `DeclaredCommitment`

Introduce a single domain noun — **declared commitment** — that encompasses
every user-declared recurring financial item, regardless of surface. Auto-seeded
obligations (VAT/SA/CT/TTP) emit the same shape but live in their own pipeline
stage because their amount/date logic is tax-rule-derived, not user-declared.

### 2. Direction-split at the schema level

`DeclaredCommitment` splits into two sibling schemas at the top:

- `DeclaredIncoming` — money we expect to receive (`rental-income`, future
  `dividend-income`, `salary-received`, etc).
- `DeclaredOutgoing` — money we expect to pay (`fixed-bill`, `subscription`,
  `payroll`, `insurance`, `tax-manual`).

Direction is encoded in the type, not a boolean field. Functions that only
apply to outgoings (e.g. "show on Obligations page") refuse to compile when
called with incoming commitments.

### 3. One cadence enum, everywhere

`CadenceSchema = z.enum(['monthly', 'quarterly', 'annual', 'one-off'])` replaces
`RecurringFrequencySchema`, `UpcomingRecurringFrequencySchema` and
`ObligationRecurrenceSchema`. The field name is `cadence` everywhere. The word
`frequency` on existing schemas is renamed during migration.

### 4. Zod-first with `z.infer` for the TS type

Schemas are declared in Zod; TS types are inferred via `z.infer`. This matches
every other shared schema in `shared/api-contracts.ts`, preserves runtime
validation at the CSV trust boundary (a typo in `commitments.csv` becomes a
parse error with a precise path, not an `undefined` deep in the pipeline), and
keeps TS-first ergonomics at consumer call sites via discriminated-union
narrowing.

#### Rejected alternatives

- **Classes implementing a common interface.** The categories have divergent
  *shape* (rental has `ownership`, payroll has `amountTolerance`, etc) but no
  divergent *behaviour* — all projection logic lives in pipeline functions.
  Classes would add N×M boilerplate (every new projector × every category) and
  break CSV round-trip. Discriminated unions + pure functions scale linearly.
- **Interfaces only, no runtime schema.** `z.infer` already yields a pure TS
  discriminated union; dropping Zod buys nothing but loses CSV validation.
- **Generate Zod from TS types.** Requires `ts-to-zod` / `typia` code
  generation the repo doesn't have; net complexity for a syntactic win.

### 5. Views own their filter; exhaustiveness via `assertNever`

Every consumer that filters `DeclaredCommitment` / `DeclaredIncoming` /
`DeclaredOutgoing` by category **must** do so through a named filter function
exported from the view module, of the form:

```ts
function showOn{ViewName}(c: DeclaredOutgoing): boolean {
  switch (c.category) {
    case 'fixed-bill':   return true;
    // ...every category enumerated
    default:             return assertNever(c);
  }
}
```

- **Locality**: the routing decision lives next to the view consuming it.
  A developer reading the view sees the rule without navigating anywhere.
- **Exhaustiveness**: adding a new category to the schema triggers a TS
  compile error in every `switch` — the developer is pointed at every call
  site that must be updated.
- **No silent drops**: omitting a case is impossible.

Bare `c.category === 'x'` checks outside the named filter functions are
banned by code review.

#### Rejected alternative: central `CATEGORY_SURFACE_MATRIX`

A single `Record<DeclaredCommitmentCategory, SurfaceFlags>` table was
considered and rejected. It gave exhaustiveness but created action-at-a-
distance: a dev debugging "why isn't insurance on Fixed Expenses?" would have
to know the matrix exists. The view-local filter approach preserves the
exhaustiveness guarantee while keeping the decision discoverable where it's
used.

### 6. Architectural fitness tests

Tests in `server/domain/commitments/registry.fitness.test.ts` import each
view's named filter and enumerate `DeclaredIncomingCategory` /
`DeclaredOutgoingCategory` values to assert invariants:

- Every declared category is surfaced on at least one view.
- Every commitment row in persistent config parses against the schema.
- No `(merchant, account, cadence)` tuple appears twice in the canonical
  stream (dedup invariant).
- Documented routing rules hold (e.g. `insurance` is always on Obligations;
  `rental-income` is never on Obligations).

Invariants are audited as code, not as a config table.

### 7. Persistence

One user-editable CSV: `commitments/commitments.csv`. Seed rows for
previously hardcoded configs (fixed-bill overrides, rental properties,
payroll entries) move to `commitments/seed.csv`, tracked in git. The
registry loader unions `seed.csv` with `commitments.csv`; user rows in
`commitments.csv` with the same `id` shadow seed rows.

The old `obligations/manual-obligations.csv` is merged into
`commitments/commitments.csv`; obligations that aren't declared commitments
(tax auto-seeded rows) continue to be inserted into the DB directly by
`sa-auto-seed`, `ct-auto-seed`, `vat-auto-seed`, `hmrc-ttp-auto-seed`.

## Consequences

- Four declaration sources collapse to one. Adding a new recurring bill is a
  one-CSV-row change (no code).
- Two cadence enums + two field names collapse to one.
- AED/GBP currency support is uniform on every surface, not just Fixed
  Expenses.
- Tax auto-seeders are unchanged conceptually but their insert shape aligns
  with `DeclaredOutgoing` so downstream projectors don't need a parallel code
  path.
- Adding a new category (e.g. `loan-repayment`) requires: one schema entry,
  updates to every `switch` in view filters (enforced by TS).
- The "where does category X appear?" audit is now a fitness test, not a
  reader's memory.

## Out of scope

- `DebtSchema` and the debts CSV — different lifecycle (opening balances,
  amortisation schedules).
- Merchant registry, transfer patterns, pass-through detection —
  categorisation concerns, not declaration.
- Category budget CSV — spending caps per category, orthogonal.
- The TTP auto-seeder's use of recurring-detector output — intentional cross-
  surface coupling, retained.
