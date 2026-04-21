# Feature Roadmap

> This app is not a finance tracker. It is a **threat elimination system for financial surprises**.
>
> Everything below is organized around one principle: closing the gap between
> "I can see what happened" and "nothing can surprise me."
>
> **The obligations registry, HMRC auto-seeders (VAT, CT, SA, HMRC TTP),
> budgets, recurring detection, overdue hero, and multi-currency/FX
> foundations are all shipped.** What remains is the forward-looking
> layer: invoices, forecasting, runway, and the agent surface that sits
> on top of them.

---

## Tier 0 — Certainty Layer ("Nothing Can Surprise Me")

### 0.1 Missed Obligation Detector — extension beyond tax

The four HMRC auto-seeders already flag unpaid tax obligations via
`getOverdueObligations()` + the `/obligations/overdue` endpoint. Generalise
the same mechanism to:

- **Insurance renewals** — the `insurance` obligation category has
  `dueDate`; detect when a due date has passed with no matching payment.
  Lapsed cover is the highest-impact silent failure on the list.
- **Mortgage / loan payments** — `debts.ts` knows merchant pattern and
  expected schedule; detect skipped monthly payments.
- **Rental income (incoming)** — detect tenant non-payment: an expected
  inbound transaction for a `rental-income` obligation that never lands.
- **Council tax, business rates** — usually 10-installment DDs; detect
  skipped months.

Out of scope: general "is this transaction weird?" detection across all
categories. Restrict strictly to items with declared schedules — false
positives on variable spend categories are worse than the miss.

### 0.2 Deadlines Tab + Calendar View

A dedicated place to track every deadline — financial obligations plus
non-financial ones — and eventually a calendar that surfaces them all
together.

- New Deadlines tab listing every tracked deadline with due date, type,
  and source.
- Seed from: obligations registry (auto) and manual deadline entries
  (new CSV + CRUD).
- Calendar view (month / quarter grid) rendering every deadline.
- Clickable entries route to the corresponding obligation or reminder.
- Companies House confirmation statement is the canonical test case —
  it fits cleanly into the existing obligations registry as a yearly
  obligation once the `other` / new `statutory` category is wired end
  to end.

This is the UI surface that makes the certainty layer visible at a
glance, and is where the calendar experience will live.

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
  - Missed-obligation signal (from 0.1).
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
Tier 0 (Certainty)              Tier 1 (Projection)          Tier 2 (Agent)

Missed Detector (extn.)  ────→  Invoice Intelligence  ────→  Financial Snapshot
Deadlines Tab + Calendar        Cash Flow Forecast           Confidence Score
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
4. **Deadlines Tab + Calendar View (0.2)** — visible surface for the
   certainty layer.
5. **Missed Obligation Detector extension (0.1)** — generalises the
   HMRC machinery to insurance, debts, rentals, council tax.
6. **Income Concentration Score (1.4)** — feeds confidence score.
7. **Financial Snapshot / Commitment Approval (2.1)** + **Confidence
   Score (2.2)** — the agent's two core reads.
8. **Alert & Notification Queue (2.3)**.
9. **Net Worth Snapshots (3.1)**.
10. **Multi-Currency extensions (3.2)**.
11. **WhatsApp / Chat Interface (2.4)**.

---

## One-Line Summary

> You don't need more analytics — you need a system that **guarantees** no obligation
> can exist, be missed, or go unnoticed, past or future.
