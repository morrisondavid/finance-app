# Config Registries — the canonical pattern

Every set-wise config in this codebase (accounts, people, merchants, payroll, company, transaction-overrides, …) follows the same shape. The shape is designed to make one thing true, repeatedly:

> **Every question the config can answer has a name, lives in one place, and is referenced by a test that fails if no one consumes it.**

This eliminates the "answers hidden in the implementation details of some function" class of bug — including the `entityId` dropdown that shipped because `EntityScopedFilterOpts` was a parallel scoping vocabulary with no named consumer.

## Why this pattern exists

Before this pattern, a set-wise config typically looked like:

- A flat `const` literal somewhere in `server/types.ts` or `server/config/*.ts`.
- Ad-hoc query functions in the same file, each with its own inline `.filter(...)` gate logic.
- Consumers either called the function or re-derived the gate inline at their call site.
- No test existed to assert the gates produced what any particular caller expected — let alone that every index/gate was actually consumed by somebody.

That shape has five practical failure modes the canonical pattern closes off:

1. **Gate logic drifts between callers.** The quadruple-gate for "is this account VAT-applicable?" lived inline in `getVatApplicableAccounts` _and_ implicitly at every `ACCOUNTS.filter(a => ACCOUNT_CONFIG[a].category === 'business')` call site. Six subtly different answers to one question.
2. **Parallel scoping vocabularies ship without detection.** `EntityScopedFilterOpts.entityId` threaded through VAT/CT helpers, `buildVatAccountFilter`, `buildCorpTaxAccountFilter`, `DashboardFilters`, the dashboard route, and the frontend dropdown — and changed nothing visible because per-account `vat.registered` already scoped.
3. **Registry boilerplate is copy-pasted.** Each registry hand-rolls `let cached`, `get`, `invalidate`, `__resetForTests`. Two exist; four more would add four more copies.
4. **Fixtures diverge from production.** Ad-hoc test data construction never routes through the real loader, so the real loader can gain a new index and tests silently keep passing with stale shapes.
5. **Type surface lies.** Options interfaces (`EntityScopedFilterOpts`, `DashboardFilters.entityId`) document capabilities the code no longer exercises; reviewers see a field and assume it means something.

## The target shape

```
server/domain/<name>/
  schema.ts      Zod schema + inferred TS types (one source of truth for shape)
  data.ts        Raw TS literal (or CSV loader for file-backed) — data only
  registry.ts    build<Name>Registry(data) → { byKey, indexes: {...} }
                 get<Name>Registry() (memoised) + invalidate + __reset for tests
  queries.ts     Named, pure query functions that return indexes or lookups
  fixtures.ts    makeTest<Name>Registry(overrides?) for consumer tests
  index.ts       Barrel re-exporting the public surface
  schema.test.ts
  registry.gates.test.ts
  registry.invariants.test.ts
  registry.lifecycle.test.ts
  queries.test.ts
  registry.manifest.test.ts
```

### `schema.ts`

- Zod schema is the source of truth for the shape.
- TS types are `z.infer<typeof Schema>`. Never hand-written.
- No imports from `registry.ts` or `queries.ts` (unidirectional).
- Tests: `schema.test.ts` — every entry in `data.ts` parses against the schema; any drift fails at boot.

### `data.ts`

- Raw `const` literal (or a thin CSV reader). Data only.
- No gate logic. No queries. No derived state. If you're writing an `if`, you're in the wrong file.
- The loader in `registry.ts` imports this and feeds it through `build<Name>Registry`.

### `registry.ts`

- `buildXRegistry(data): XRegistry` — pure, no I/O after data is loaded. Computes every index. Throws on invariant violations (duplicate keys, dangling references).
- `getXRegistry()` / `invalidateXRegistry()` / `__resetXRegistryForTests()` — built on `_shared/create-registry.ts`. Do not roll your own.
- Indexes live on `registry.indexes.<name>` — `ReadonlyMap` or `readonly T[]` — and are precomputed once at boot. **No consumer does `.filter(...)` on raw data.**
- Every index answers one named question. `indexes.vatApplicable`, `indexes.byEntity`, `indexes.directors`. If an index name is not a direct answer to a user-or-developer-facing question, it does not belong.

### `queries.ts`

- Named, pure functions: `vatApplicableAccounts()`, `getAccountConfig(name)`, `isBusinessAccount(name)`.
- Take the registry as an optional parameter with default `= getXRegistry()`. Tests inject fixture registries without global state pollution.
- Query bodies do _not_ contain `.filter(...)` — they return indexes or do O(1) map lookups.
- Gate logic lives in the loader, not the queries.

### `fixtures.ts`

- `makeTestXRegistry(overrides?)` — consumer-test fixture, built on `_shared/fixture-builder.ts`.
- Routes through the real `buildXRegistry` so fixtures can never diverge from production index shapes.

### `index.ts`

- Barrel. Re-exports the public surface. Consumers import from here.

## Gates in the loader, not the queries

**Wrong:**

```ts
// queries.ts
export function vatApplicableAccounts(): readonly AccountName[] {
  return registry.all.filter(a => {
    if (!isBusinessConfig(a)) return false;
    if (!a.business.vat.applicable) return false;
    if (a.business.vat.registered !== true) return false;
    return true;
  });
}
```

**Right:**

```ts
// registry.ts (build)
const vatApplicable = filterToIndex(accounts, a =>
  a.category === 'business' &&
  a.business.vat.applicable &&
  a.business.vat.registered === true,
);
// → registry.indexes.vatApplicable

// queries.ts
export function vatApplicableAccounts(
  reg: AccountsRegistry = getAccountsRegistry(),
): readonly AccountName[] {
  return reg.indexes.vatApplicable;
}
```

The gate is encoded once. Every caller reads it O(1). Changing the gate means changing one line; every consumer sees the change on the next boot.

## The shared scaffold: `server/domain/_shared/`

These primitives are imported by every registry. Do not roll your own versions.

### `createRegistry({ name, build })`

Memoisation, invalidation, and test-reset, written once. Every registry:

```ts
const handle = createRegistry({
  name: 'accounts',
  build: () => buildAccountsRegistry(ACCOUNT_CONFIG_DATA),
});
export const getAccountsRegistry = handle.get;
export const invalidateAccountsRegistry = handle.invalidate;
export const __resetAccountsRegistryForTests = handle.__resetForTests;
```

Registries whose build input is mutable (e.g. a CSV directory that the POST classify endpoint redirects for tests) close over a module-level variable inside their own `build` closure and wrap `__resetForTests` with a registry-specific reset that also resets that variable. See `server/domain/transaction-overrides/registry.ts` (post-B6) for the pattern.

### `groupBy`, `indexBy`, `filterToIndex`, `mapToIndex`

Declarative index builders. Loaders stay one-line-per-index:

```ts
const byEntity = groupBy(accounts, a => a.entityId);
const byName = indexBy(accounts, a => a.name, { indexName: 'byName' });
const business = filterToIndex(accounts, a => a.category === 'business');
```

### `shallowMergeFixture`, `defineFixtureBuilder`

Per-registry fixture helpers are a thin wrapper around these. Consumer tests that need a tweaked registry get a one-liner; the fixture routes through the real `build`.

### `assertManifestConsumers({ registry, consumers })`

The manifest-test helper. Every `registry.manifest.test.ts` is a one-line call listing each index key with its consumer file(s) + function(s). Orphaned indexes fail with a readable diff.

## The canonical testing template

Every registry ships the six test files below. Regression-proof by default; a new registry cannot merge without answering the same six questions every other registry answers.

| File | Purpose |
|---|---|
| `schema.test.ts` | Every entry in `data.ts` parses against the Zod schema. Catches data/schema drift at build time. |
| `registry.gates.test.ts` | One describe block per index, enumerating the gate logic exhaustively. For `indexes.vatApplicable`: includes a registered + applicable + business account; excludes `vat.applicable=false`; excludes `vat.registered !== true`; excludes `category === 'personal'`. |
| `registry.invariants.test.ts` | Cross-index consistency: every entry in `vatApplicable` ⊂ `business`; every entry in `corpTaxApplicable` ⊂ `business`; `business ∪ personal === byName.keys()`; etc. |
| `registry.lifecycle.test.ts` | Memoisation (`get()` returns same reference), `invalidate()` busts, `__resetForTests(override)` swaps, `__resetForTests()` rebuilds. |
| `queries.test.ts` | Query purity: every query function takes a fixture registry param, returns deterministic results, never reaches for global state. |
| `registry.manifest.test.ts` | One-line call to `assertManifestConsumers`. Every index key paired with its consumer file(s). |

## The manifest-test contract

```ts
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildAccountsRegistry } from './registry.js';
import { ACCOUNT_CONFIG_DATA } from './data.js';

describe('accounts registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    assertManifestConsumers({
      registry: buildAccountsRegistry(ACCOUNT_CONFIG_DATA),
      consumers: {
        business: [
          { file: 'server/utils/recurring-pipeline.ts', functions: ['...'] },
          { file: 'server/routes/dashboard.ts', functions: ['...'] },
        ],
        vatApplicable: [
          { file: 'server/db/repositories/vat-auto-seed.ts', functions: ['seedVat'] },
          { file: 'server/db/utils/tax-account-filter.ts', functions: ['buildAccountInFilter'] },
        ],
        // ... every index key appears here with ≥1 consumer
      },
    });
  });
});
```

**Rules enforced by the helper:**

1. Every key on `registry.indexes` appears in `consumers` with a non-empty list.
2. Every key in `consumers` corresponds to a real index.
3. Every `consumer.file` exists on disk.

Violation = loud test failure with a readable aggregate diff.

**Why this catches capability drift.** When a consumer is removed, the developer either deletes the manifest entry (and reviewers see the delete → ask "should the index be deleted too?") or leaves the entry pointing at a non-existent function (and the manifest test flags it). The Entity dropdown would have been caught on day one: `DashboardFilters.entityId` had no consumer, `EntityScopedFilterOpts` had only itself — both would have been flagged.

## Naming convention

| Thing | Convention |
|---|---|
| Build function | `build<Name>Registry` |
| Getter | `get<Name>Registry` |
| Invalidator | `invalidate<Name>Registry` |
| Test reset | `__reset<Name>RegistryForTests` |
| Fixture builder | `makeTest<Name>Registry` |
| Directory | `server/domain/<name>/` (kebab-case, plural if naming a collection) |
| Data file | `data.ts` |
| Indexes field | `registry.indexes` (never `registry.idx`, `registry.by`, etc.) |
| Primary-key lookup | `registry.byKey` (e.g. `byName`, `byId`) |

## UI-control code-review checklist

Added here because it's the post-mortem artefact from the Entity dropdown — a dropdown that threaded an `entityId` parameter through six layers and changed nothing, because per-account `vat.registered` / `corporationTax.applicable` / `entityId` already did the scoping.

**The rule:**

> **A UI control must change at least one visible field in the response via a path not already expressed by existing config; if not, the control shouldn't exist.**

**Reviewer checklist** — apply to every new / modified filter, dropdown, toggle, segmented control, or request-shape parameter:

1. **Name the field it changes.** Which response field (or set of fields) becomes different when the control toggles? If the answer is "none — the server just receives the param", the control is inert. Reject.
2. **Trace the path.** Follow the param from the UI through the API contract, route handler, query, registry, and data. Write down the exact step where it branches behaviour. If the branch is "passed through and ignored", reject.
3. **Check for a parallel vocabulary.** Does the param duplicate a gate already expressed by a registry index or per-row config field (`vat.registered`, `category === 'business'`, `entityId`, `active`)? If yes, the registry is already doing the job. Delete the param.
4. **Require a manifest consumer.** If the control reads from a registry index, that index must already appear in the registry's `registry.manifest.test.ts` with a consumer file + function pointing at the new UI code. If you're adding the index, add the manifest entry in the same PR.
5. **Require a test that fails without the control.** Add a test asserting the response differs between the two control states. If the test passes with the control removed, the control is cosmetic. Delete it.
6. **Name the question the control answers.** A filter exists to answer one named question (e.g. "show only VAT-applicable accounts"). If you can't name the question, or the name collapses into an existing index's name, reject.

A new dropdown / filter / toggle that maps 1:1 to a flag already on a registry row is a redundant control — the flag is already doing the scoping. The registry, not the UI, is the scoping vocabulary. Any UI control that tries to re-parameterise it is dead code in waiting.

## Registry directory

Every set-wise config in the codebase currently following the canonical pattern:

| Registry | Location | Purpose | Indexes |
|---|---|---|---|
| `accounts` | `server/domain/accounts/` | UK + UAE bank / credit-card accounts with per-account VAT / CT / reporting gates. Source: `ACCOUNT_CONFIG_DATA` literal. | `business`, `personal`, `byEntity`, `vatApplicable`, `vatApplicableByEntity`, `corpTaxApplicable`, `corpTaxApplicableByEntity`, `outgoingPaymentsCapable`, `businessOutgoingPayments`, `personalOutgoingPayments`, `excludeTransfersFromIncome`, `showTaxLiabilities`, `creditCards` |
| `people` | `server/domain/people/` | The humans this ledger tracks (directors, Self Assessment filers, alias matchers). Source: `PEOPLE_DATA` literal. | `directors`, `saFilers`, `aliasRegexes` |
| `payees` | `server/domain/payees/` | HMRC narrative patterns used by tax-auto-seeders. Not a registry — flat pattern lists; lives here because it pairs with directors (held in the people registry). | _(n/a — flat module, not registry-shaped)_ |
| `merchants` | `server/domain/merchants/` | Pattern list that maps raw transaction descriptions → `(category, displayName)`. Source: `STATIC_MERCHANT_DATA` + person-derived narrowing entries. | `patterns`, `byCategory`, `byDisplayName` |
| `payroll` | `server/domain/payroll/` | Derived view joining `payroll`-category obligations with directors in the people registry. | `entries`, `byAccount`, `byPersonAccount`, `directorsById` |
| `company` | `server/domain/company/` | Legally-distinct entities (UK Ltd, UAE FZCO). Source: `autonize-it/company.csv`. | `byId`, `byJurisdiction`, `active` |
| `transaction-overrides` | `server/domain/transaction-overrides/` | Per-transaction category overrides keyed by hash. Source: `autonize-it/transaction-category-overrides.csv`. | `byHash` |

`server/domain/obligations/` is pre-existing but not yet migrated onto `createRegistry`; bringing it under the canonical shape is tracked separately from this phase.

## Out of scope for this pattern

Flat-constant parameter modules — scalars / tables with no set-wise queries — stay as plain `const` modules:

- `server/config/tax-rates.ts`
- `server/config/tax-rules.ts`
- `server/config/transfer-patterns.ts`
- `server/config/exchange-rates.ts`

These don't need indexes; they need `const RATE = 0.20` plus a lookup helper. If one gains set-wise queries later, migrate it to this pattern.
