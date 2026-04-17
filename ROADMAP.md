# Feature Roadmap

> This app is not a finance tracker. It is a **threat elimination system for financial surprises**.
>
> Everything below is organized around one principle: closing the gap between
> "I can see what happened" and "nothing can surprise me."

---

## Tier 0 — Certainty Layer ("Nothing Can Surprise Me")

### 0.1 Obligation Registry

Every financial obligation gets a record: type, amount, frequency, authority, due date, status.

- New `financial_obligations` table (amount, due date, recurrence, entity, status)
- Auto-populated from known schedules (VAT quarters are already in config — the dates just aren't tracked as deadlines)
- Manual entries for one-offs (e.g. a tax bill just remembered)
- This is the table the AI agent queries when asked "what do I owe this month?"

### 0.2 Coverage Audit

The system must flag obligation *types* with no record, closing the unknown-unknowns gap.

- Checklist engine: VAT, corp tax, PAYE, self assessment, loans, subscriptions, insurance
- Each has expected frequency and expected authority (HMRC, lender, etc.)
- System flags gaps: "You have no PAYE obligations — confirm none exist"
- Seeded from existing `tax-rates.ts` config and `HMRC_PATTERNS`

### 0.3 Missed Obligation Detector (backward-looking)

Not just future deadlines — scan the past for things already missed.

- Compare expected obligations vs actual payments in transaction history
- Output: "Corporation tax likely due but no payment recorded" / "Expected VAT submission missing"
- `getCurrentVatQuarter()` + `HMRC_PATTERNS` already get 80% of the way there for VAT
- Extends to all obligation types in the registry

### 0.4 Tax Rate Staleness Alert

`tax-rates.ts` is hardcoded for 2023/24 and 2024/25. When HMRC changes rates each April, someone has to remember to update them — exactly the kind of admin task that slips.

- Timestamp or metadata tracking when tax config was last verified
- System flags: "Your tax config was last updated for 2024/25 — HMRC rates may have changed"

### 0.5 Accountant Filing Tracker

The VAT quarter ZIP export and accountant package download exist, but there is no tracking of whether the accountant actually filed.

- The chain: data collected → ZIP exported → accountant files → HMRC confirms
- Currently only steps 1-2 are tracked
- The obligation engine needs a "confirmed filed" status per quarter

---

## Tier 1 — Projection Layer ("What's Coming")

### 1.1 Cash Flow Forecast / Runway Projection

All the ingredients exist but are never combined to answer "What will my balance be in 30/60/90 days?"

- `account_balances` has opening balances (stored)
- `recurring-detector.ts` identifies recurring income and expense patterns (detected)
- Tax liabilities are estimated
- No engine connects them into a forward projection
- This is the single most important feature for an AI agent — it powers "can I afford this holiday?"

### 1.2 Worst Case / Runway Mode

One button: "If all income stops today."

- Output: runway in months, mandatory vs optional spend, survival threshold
- Uses forecast engine + the bills/QoL split already computed in `expenses-insight.ts`
- Should include available credit headroom as emergency runway
- Removes the mental looping of "am I safe?" — the app answers directly

### 1.3 Shock Simulator

Simulate specific scenarios and convert fear into numbers.

- "If your biggest client leaves" → impact on cashflow, months until problem
- "If tax bill hits early" → deficit in Y weeks
- "If rental void for 2 months" → runway change
- "If contract ends" → months until problem
- Uses forecast engine + income source tracking

### 1.4 Seasonal Pattern Learning

Multi-year transaction data exists. December and January reliably spike (gifts, insurance renewals, annual subscriptions).

- The circular statistics in `recurring-detector.ts` can be applied to total monthly spend
- Forecast should account for historical seasonal patterns rather than assuming flat monthly averages
- Significantly improves forecast accuracy for months with known spikes

### 1.5 Income Concentration Score

Income totals are tracked but there is no analysis of where income comes from.

- If 90% of revenue comes from one client, that is a single point of failure
- Income transactions grouped by source with concentration percentage
- An AI agent answering "am I safe?" needs to know this risk

---

## Tier 2 — Enforcement Layer ("Hard Stops")

### 2.1 Commitment Approval API

Before any spend, ask "Can I afford this?" — this is the WhatsApp agent's core job.

- System responds: safe / reduces runway to X / creates deficit in Y days
- Single endpoint the agent calls before answering any spending question
- Needs: current liquid balance, committed outgoings for next N days, uncommitted/discretionary balance, recent spending velocity vs budget

### 2.2 Budget Enforcement Mode

The app tracks budgets (caps on spending) but they are soft. Systemise hard stops.

- Define: fixed account (bills), variable account (spending)
- Enforce: "You have £X left this month. Hard stop."
- Extends `category_budgets` with an enforcement flag
- No thinking required — the system says yes or no

### 2.3 Anomaly / Missing Payment Detection

`recurring-detector.ts` identifies monthly and annual recurring transactions, but there is no mechanism to flag deviations.

- "This bill was £80 higher than usual"
- "Expected salary didn't arrive"
- "Subscription charged twice this month"
- The recurring detector gives the expected pattern — compare against actuality

### 2.4 Category Override System

Categories are derived at runtime via `merchant-registry.ts` regex matching. There is no way to override a miscategorization. If the registry gets it wrong, every query using that category is wrong.

- New `category_overrides` table (transaction hash → corrected category)
- Applied after the regex matcher in `categorizer.ts`
- The AI agent could learn patterns: "you always recategorize X as Y" and suggest corrections

### 2.5 Credit Headroom Tracking

Capital on Tap and Barclaycard are configured as credit cards in `ACCOUNT_CONFIG`, but there is no concept of credit limits or available credit.

- New fields on `account_balances` for credit limits
- Available credit as part of the safety picture
- "£12k available across credit cards" feeds into worst-case/runway calculations

---

## Tier 3 — AI Agent Layer ("Proactive Guardian")

### 3.1 Financial Snapshot Endpoint

`/api/dashboard/summary` returns data shaped for the UI. An AI agent needs a different shape.

- Current liquid balance across accounts
- Committed outgoings for the next N days (from obligations engine)
- Uncommitted/discretionary balance
- Recent spending velocity vs budget
- Single "affordability API" the agent calls before answering any spending question

### 3.2 Confidence Score

A daily psychological stabiliser: a single number that answers "am I safe?"

- Financial Safety: 8.5 / 10
- Unknown Risk: Low / Medium / High
- Composite of: obligation coverage %, forecast health, anomaly count, budget adherence, income concentration
- If score drops → the agent investigates and explains why

### 3.3 Financial Memory Layer

The biggest operational issue: things get forgotten.

- AI builds persistent memory: "You usually pay X every quarter" / "You forgot Y last year"
- Pattern store the agent reads and writes
- Warns proactively based on learned patterns, not just configured rules

### 3.4 Behavior Drift Detection

Not just missed payments — spending creep.

- "Your discretionary spend is 40% higher than your 3-month average"
- "Subscription costs have increased £45/month since January"
- Monthly aggregates compared against rolling window

### 3.5 Alert & Notification Queue

The app is entirely pull-based. There is no notification path — no email, no webhook, no push.

- New `pending_alerts` table (trigger, message, severity, delivery status)
- Trigger conditions: obligation approaching, budget breach, anomaly detected, balance below threshold, confidence score drop
- Delivery layer: WhatsApp API, email, etc.
- Without this, the AI agent can only answer questions — it cannot proactively warn

### 3.6 Savings Goals / Targets

Budgets cap spending, but there is no concept of saving toward something. Budget nudges only say "you're overspending in X." The inverse — "you're £800 away from your holiday fund" — does not exist.

- New `savings_goals` table (name, target amount, deadline, current progress)
- Tracked against balance minus commitments
- For an AI agent, goals give it something to measure against when asked aspirational questions

---

## Tier 4 — Polish (Only After Everything Above)

### 4.1 Net Worth Tracking Over Time

Point-in-time balances exist but there are no historical snapshots. Cannot answer "am I richer than 6 months ago?"

- Simple `net_worth_snapshots` table (date, total liquid, total obligations)
- Taken daily or weekly
- Enables trend analysis — powerful context for an AI agent

### 4.2 Invoice Intelligence

Invoices are stored and downloadable but are just files in a directory. No metadata extraction, no linking to transactions.

- Parse invoice metadata (amount, date, vendor, invoice number)
- Link to matching transactions
- AI agent can answer "where's my invoice for that £2,400 payment?"

### 4.3 Multi-Currency / FX Tracking

All parsers are GBP-centric (Barclays, NatWest, Monzo, Barclaycard, Capital on Tap).

- Foreign transactions on UK cards need FX rate capture
- Overseas accounts would need new parsers
- AI agent handles "how much have I spent in AED this month?"

### 4.4 WhatsApp / Chat Interface

This is the delivery channel, not the logic. Build last.

- Conversational interface wrapping the financial snapshot + commitment approval + alerts
- The AI agent is only as good as the layers underneath it

---

## Dependency Chain

```
Tier 0 (Certainty)       Tier 1 (Projection)       Tier 2 (Enforcement)       Tier 3 (AI Agent)

Obligation Registry ────→ Cash Flow Forecast ──────→ Commitment Approval ─────→ Financial Snapshot
Coverage Audit            Worst Case Mode            Budget Enforcement          Confidence Score
Missed Detector           Shock Simulator            Anomaly Detection           Alert Queue
Tax Staleness Alert       Seasonal Patterns          Category Overrides          Financial Memory
Accountant Tracker        Income Concentration       Credit Headroom             Behavior Drift
                                                                                 Savings Goals
```

The AI agent is the **last** layer, not the first. It is a delivery mechanism for the intelligence underneath. Build the certainty and projection layers first — the agent just wraps them in conversation.

---

## One-Line Summary

> You don't need more analytics — you need a system that **guarantees** no obligation
> can exist, be missed, or go unnoticed, past or future.
