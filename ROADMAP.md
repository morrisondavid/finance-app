# Feature Roadmap

> This app is a **threat elimination system for financial surprises** — closing the gap between “I can see what happened” and “nothing can surprise me.”

## At a glance

| Area | Status |
|------|--------|
| **Tier 0** — obligations, tax auto-seeds, budgets, deadlines, **Dashboard liquidity** + rolling **12‑month commitments** | Shipped |
| **Tier 1** — multi-entity, clients/contracts, invoicing + reconcile, working-days ledger, forecast, runway, income composition, warnings spine, debt strategy | Shipped |
| **Tier 2** — semantic balance/tax discriminators, **`/api/ai/*` slices**, **generated manifest**, **MCP** (`bankstatements://ai/*`), financial snapshot, financial safety score, enriched warnings + **`userState`** | Shipped (`AI_MANIFEST_SCHEMA_VERSION` **2.5.0** on the wire) |
| **Tier 3** — net-worth CSV history, cross-currency AI slices, transfer-pairing ↔ merchants consolidation, config-registry pattern | Shipped |
| **§3.4** — automated statement **ingestion** (Open Banking / GoCardless, then Monzo direct + IMAP where needed) | **Next (in-repo)** |
| **Channels** (WhatsApp, *etc.*) | Out of repo — orchestrator consumes HTTP/MCP |

Deep design notes for the AI layer (balance semantics, expected receipts, MCP rules) live in **code + `shared/api-contracts.ts`**; this file stays a **product map**, not a spec dump.

---

## Shipped — what the product can do (summary)

**Certainty & cash spoken for.** Unified obligations + deadlines + ICS; household liquidity (cash vs credit, static FX, per-account lines) and **committed outflows** over the next 12 calendar months with cash-after model; recurring detection; multi-currency (GBP + AED) and entity-aware tax.

**Projection & contracts.** Client/contract registries, accrual from working-days + leave + holidays, invoicing (draft PDF, self-bill ingest, **payment reconcile** with FX), forecast timeline, **runway** (household stress + entity drill-down; Strategy hero vs sandbox accrual paths), **income composition** + property leverage signals.

**Risk & planning.** Consolidated **Warnings** tab (typed `context`, snapshots, reserves); **Debt Strategy** (plans, movements, sandbox); budgets with nudges.

**AI / agents.** Small composed HTTP endpoints + **MCP resources** for liquidity (incl. commitments), pipeline, runway, snapshot, manifest, warnings, spend, income composition, debt strategy, financial snapshot, financial safety, net-worth history, capture tool, **spend-by-currency**, **entity-liquidity-fx**; **`PUT /api/warnings/user-state`** for snooze/ack. Orchestrators are expected to call this server — not live inside it.

**Historical & hygiene.** Net-worth snapshots CSV + AI/MCP read/capture; cross-currency expense/liquidity helpers for agents; **transfer pairing seeds** shared with merchants where labels must match; registry pattern doc in [docs/config-registries.md](docs/config-registries.md).

---

## Next — §3.4 Automated statement ingestion

**Problem.** Data still enters via **manual** bank exports → `/api/upload` → `server/parsers/*.ts`. That is the main lag vs “live” finances.

**Principle.** **Parsers stay.** New work is **acquisition + normalization** to the same row shape the parsers already expect, then existing **hash dedup** ([`server/db/repositories/transactions.ts`](server/db/repositories/transactions.ts)).

**Target layout**

```text
server/ingestion/
  sources/          # gocardless-obi, monzo-direct (later), email-attachment (later)
  normalizers/      # e.g. OBI JSON → rows the parsers accept
  pipeline.ts       # source → normalize → parser → insert
  schedules.ts      # or CLI/cron outside the process
```

**Per-account plan (from roadmap research)**

| Account | Primary automation | Fallback |
|---------|------------------|----------|
| `barclays-current`, `barclays-savings`, `barclaycard`, `capital-on-tap`, `natwest`, `santander-everyday` | **GoCardless Bank Account Data** | CSV upload |
| `monzo-joint` | **Monzo API** (direct — richer than OBI) | CSV upload |
| `emirates-islamic` | **IMAP** statement attachment (until UAE coverage matures) | PDF/CSV upload |

**Product must-haves**

- **Secrets:** API keys / refresh tokens **not** in git or SQLite payloads — env + OS keychain (or similar); DB holds opaque `credentials_ref` + connection metadata (see earlier roadmap sketch: `account_connections`, `ingestion_runs`, optional `transactions.source` / `source_ref`).
- **90-day PSD2 re-consent:** surface as warnings/deadlines + connection health (last pull, reconsent due).
- **Observability:** log each pull (rows fetched / inserted / deduped); silent failure → visible within a day.
- **Tests:** fixture JSON per source; overlap test (manual CSV + feed) proves dedup.

**Manual / one-off**

- GoCardless (or alternative AISP) developer signup, institution mapping, link flow per bank.
- Full history pre–Open-Banking window: **GDPR SAR**-style exports are a **one-off manual** seed, not the live feed.

**Reference:** product/legal rationale (e.g. FreeAgent not a raw feed) and older narrative: [plan transcript](e17fa411-9f76-418e-b41e-1425b9562fb9).

---

## Optional follow-ons (not committed)

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
depends on to route per-entity credentials. 3.4 can ship whenever
scheduled; it has no upstream dependency on the forecasting stack
(1.2 – 1.9).

---

### 3.5 Canonical Config Registry Pattern (architecture) ✅ SHIPPED

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
                                                                                                                                     ├─→ Worst Case (1.6) ✅┤                        Financial safety (2.2) ✅
                                                                                                                                     │                  │                          Warnings metadata (2.3) ✅
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
shipped. **§2.0.A–G** (AI primitives, slices, manifest, MCP) forms the base agent layer. **§2.0.H** is shipped (manifest + `/api/ai/*` + MCP for warnings, spend/expenses, income composition, debt strategy). **Tier 0 extension:** dashboard **`liquidityCommitments`** (12-month rolling projection) + AI/MCP parity — **§0.2**, **`AiLiquidityResponseSchema`**. **§2.1** Financial Snapshot — **`GET /api/ai/financial-snapshot`** / MCP (see §2.1; snapshot landed at manifest **2.1.3**). **§2.2** Financial Safety — **`GET /api/ai/financial-safety`**, MCP, dashboard embed (see §2.2). **§2.3** Warnings metadata + **`userState`** — **`GET /api/ai/warnings`**, **`PUT /api/warnings/user-state`**, manifest **2.5.0** (see §2.3). **§3.1** Net worth snapshots — CSV + **`GET /api/ai/net-worth-history`** + MCP + **`capture_net_worth_snapshot`** (see §3.1). **§3.2** Agent cross-currency AI — **`GET /api/ai/spend-by-currency`**, **`GET /api/ai/entity-liquidity-fx`**, MCP resources (see §3.2). **Follow-on:** optional MCP write tools for warnings; **channels** stay outside this repo.

**The Warnings Engine (1.8)** remains the single severity-ranked spine for **explicit risk flags**. §2.2 **combines** that spine (as a **modifier**) with **liquidity, runway, and income** so “safe” is not defined by warning count alone. §2.3 adds **agent-facing metadata** on warnings (not a second engine).

**Structured Data for AI (2.0) gates all of Tier 2.** ~~Snapshot (2.1)~~ ✅ **shipped**; ~~Financial Safety Score (2.2)~~ ✅ **shipped**;
**Warnings metadata (2.3)** depends on 2.0's semantic-drift cleanup (balance / debt /
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
12. ~~**Financial Snapshot (2.1)**~~ ✅ SHIPPED (initial) — `GET /api/ai/financial-snapshot`, MCP `bankstatements://ai/financial-snapshot`, **`AiFinancialSnapshotResponseSchema`** (landed **2.1.3**); current manifest **`AI_MANIFEST_SCHEMA_VERSION`** **2.5.0** (incl. §3.1–§3.2) — see **§2.1**–**§2.3**, **§3.1**, **§3.2**.
13. ~~**Financial Safety Score (2.2)**~~ ✅ SHIPPED — **`GET /api/ai/financial-safety`**, MCP `bankstatements://ai/financial-safety`, **`AiFinancialSafetyResponseSchema`**, **`formulaVersion` `1.0.0`**, dashboard **`financialSafety`**; see **§2.2**.
14. ~~**Warnings metadata & agent ergonomics (2.3)**~~ ✅ SHIPPED (read APIs + MCP + user-state writes) — enriched `GET /api/ai/warnings` / MCP / `GET /api/warnings/*`, **`PUT /api/warnings/user-state`**; **`orchestratorState`** orchestrator-owned; see **§2.3**.
15. ~~**Net Worth Snapshots (3.1)**~~ ✅ SHIPPED — CSV `net-worth/net-worth-snapshots.csv` (weekly default; `NET_WORTH_SNAPSHOT_CADENCE=daily` optional), `GET /api/ai/net-worth-history`, `POST /api/ai/net-worth/snapshot`, MCP **`bankstatements://ai/net-worth-history`** + tool **`capture_net_worth_snapshot`**; auto-capture after `initDatabase()`; manifest **`AI_MANIFEST_SCHEMA_VERSION`** now **2.5.0** — see **§3.1**, **§3.2**.
16. ~~**Agent cross-currency queries (3.2)**~~ ✅ SHIPPED — `GET /api/ai/spend-by-currency`, `GET /api/ai/entity-liquidity-fx`, MCP **`bankstatements://ai/spend-by-currency`** (defaults: current month) + **`entity-liquidity-fx`**; manifest **2.5.0**; **`liquidityOverview.lines`** on **`GET /api/ai/liquidity`** for per-account native/GBP — see **§3.2**.
17. **(External)** Agent orchestration & notification channels — conversational stack (e.g. WhatsApp) consumes **`bankstatements://ai/*`** + REST; delivery not an in-repo milestone.

---

## One-line summary

> You need a system that **guarantees** no obligation can exist, be missed, or go unnoticed — and that shows **what cash is spoken for** on a rolling horizon, not just balances.
