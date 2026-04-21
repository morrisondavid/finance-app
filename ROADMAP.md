# Feature Roadmap

> This app is not a finance tracker. It is a **threat elimination system for financial surprises**.
>
> Everything below is organized around one principle: closing the gap between
> "I can see what happened" and "nothing can surprise me."
>
> **The obligations registry, HMRC auto-seeders (VAT, CT, SA, HMRC TTP),
> budgets, recurring detection, overdue hero, missed-obligation detector
> (annual / one-off non-tax items with Mark Paid + auto-match), and
> multi-currency/FX foundations are all shipped.** What remains is the
> forward-looking layer: invoices, forecasting, runway, and the agent
> surface that sits on top of them.

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

### 1.1 Invoice Intelligence (foundation for everything projection-related)

**The highest-priority unbuilt item.** Without invoice data:

- VAT calculations are guesswork — the reconciler uses bank-ledger
  heuristics, not actual invoice totals.
- Income forecasting is backward-looking only — invoiced-but-not-yet-paid
  revenue is invisible to any projection.

Invoices today are just files in `/invoices`. Make them data:

- Parse invoice metadata: amount, date, vendor, invoice number, VAT
  amount, currency.
- New `invoices` table keyed by invoice number; CSV-backed like the rest
  of the app.
- Link invoices to matching transactions by amount + date proximity
  (reuse `matchPaymentsToSlots` machinery from the HMRC seeders).
- Surface **expected income** (invoiced, not yet settled) on the
  dashboard and feed it into the forecast engine (1.2).
- Improve VAT reconciliation: compare VAT on invoices issued vs. VAT
  collected into the account — turns the current heuristic into a
  derivation with audit trail.
- Support the reverse lookup: "where is my invoice for this £2,400
  payment?" as a one-click query on the transaction row.

Build this **before** the cash-flow forecast — the forecast's accuracy
on the income side is capped by whether we know about outstanding
invoices.

### 1.2 Cash Flow Forecast / Runway Projection

The single most important feature behind the whole app. All ingredients
exist but nothing stitches them together:

- `account_balances` has opening balances.
- `recurring-detector` / `recurring-upcoming` identifies recurring income
  and expenses with predicted next-charge dates.
- Obligations registry provides known future outgoings with due dates.
- Tax liabilities are estimated by the HMRC auto-seeders.
- Invoices (from 1.1) provide expected inbound income.

Output: "what will my balance be in 30 / 60 / 90 days?" per account and
across the business / household as a whole.

This is the endpoint the AI agent calls before answering "can I afford
this holiday?"

### 1.3 Worst Case / Runway Mode

One button: "if all income stops today".

- Output: runway in months, mandatory vs optional spend, survival
  threshold.
- Uses the forecast engine + the bills / QoL split already computed in
  `expenses-insight.ts`.
- Includes available credit headroom as emergency runway.
- Credit limit is currently approximated by each credit card's opening
  balance (the user has been treating opening balance *as* the limit for
  existing dashboard calculations). Formalise this as a derived
  `creditLimit` on `AccountConfigSchema` — default to the opening
  balance so nothing changes semantically, but the intent becomes
  explicit and the field is available for future tuning.

### 1.4 Income Concentration Score

Income totals are tracked but not analysed by source.

- Group income transactions (and invoices, from 1.1) by payer / client.
- Concentration percentage per source.
- Flag single-point-of-failure risks ("90% of income comes from one
  client").
- Feeds the confidence score (2.2).

Combined with invoices (1.1), this is the first time the agent has
enough signal to answer "am I safe?" with something meaningful.

---

## Tier 2 — AI Agent Layer ("Proactive Guardian")

### 2.1 Financial Snapshot / Commitment Approval

Single endpoint the agent calls before answering any spending question.

- Current liquid balance across accounts.
- Committed outgoings for next N days (from obligations + recurring
  detector).
- Expected inbound from outstanding invoices (from 1.1).
- Uncommitted / discretionary balance.
- Recent spending velocity vs budget.
- Verdict: safe / reduces runway to X / creates deficit in Y days.

Replaces the agent-side shape that `/api/dashboard/summary` can't
provide (the summary is UI-shaped and not task-shaped for affordability
questions).

### 2.2 Confidence Score

A daily psychological stabiliser: a single number that answers "am I
safe?"

- Financial Safety: 8.5 / 10.
- Unknown Risk: Low / Medium / High.
- Composite of:
  - Missed-obligation signal (existing overdue hero + auto-matcher).
  - Forecast health (from 1.2).
  - Invoice-to-payment gap (from 1.1).
  - Budget adherence (from existing budgets).
  - Income concentration (from 1.4).
- Score drop → agent investigates and explains why.

### 2.3 Alert & Notification Queue

The app is entirely pull-based today — no email, no webhook, no push.

- New `pending_alerts` CSV/table (trigger, message, severity, delivery
  status).
- Trigger conditions: obligation approaching, missed expected payment
  (from 0.1), balance below threshold, confidence score drop, data
  freshness timeout (no statement upload for account X in N weeks).
- Delivery layer: WhatsApp API, email.
- Without this, the agent can only answer questions — it cannot
  proactively warn.

### 2.4 WhatsApp / Chat Interface

Delivery channel, not logic. Wraps 2.1 + 2.2 + 2.3 in conversation. Ship
last — the agent is only as good as the layers underneath it.

---

## Tier 3 — Historical & Polish

### 3.1 Net Worth Tracking Over Time

Point-in-time balances exist; no historical snapshots.

- New `net_worth_snapshots` table (date, total liquid, total
  obligations, total debt, net).
- Daily or weekly cadence.
- Trend context for the agent ("am I richer than 6 months ago?").

### 3.2 Multi-Currency / FX — extensions

Parsers and FX support already exist (`emirates-islamic` parser,
`currency-exchange-client`, GBP ↔ AED rates, `nativeAmount` /
`nativeCurrency` on line items). What's left:

- Historical FX rate capture per transaction (we currently always apply
  the latest rate).
- Multi-currency breakdown on dashboard totals (currently implicitly
  GBP).
- Agent-facing: "how much have I spent in AED this month?"

---

## Dependency Chain

```
Tier 0 (Certainty) ✅            Tier 1 (Projection)          Tier 2 (Agent)

Obligations + Deadlines ────→   Invoice Intelligence  ────→  Financial Snapshot
(shipped)                       Cash Flow Forecast           Confidence Score
                                Worst Case / Runway          Alert Queue
                                Income Concentration         WhatsApp Interface
```

**Invoices gate the forecast** because outstanding invoices are the
single biggest piece of expected-income data the current system can't
see. **The forecast gates everything in Tier 2** — the agent, the
confidence score, the proactive alerts.

---

## Suggested Build Order

1. **Invoice Intelligence (1.1)** — unblocks VAT accuracy and income
   forecasting.
2. **Cash Flow Forecast (1.2)** — the single biggest behaviour change
   the app can make.
3. **Worst Case / Runway + formalised credit headroom (1.3)** —
   cheap once 1.2 lands.
4. **Income Concentration Score (1.4)** — feeds confidence score.
5. **Financial Snapshot / Commitment Approval (2.1)** + **Confidence
   Score (2.2)** — the agent's two core reads.
6. **Alert & Notification Queue (2.3)**.
7. **Net Worth Snapshots (3.1)**.
8. **Multi-Currency extensions (3.2)**.
9. **WhatsApp / Chat Interface (2.4)**.

---

## One-Line Summary

> You don't need more analytics — you need a system that **guarantees** no obligation
> can exist, be missed, or go unnoticed, past or future.
