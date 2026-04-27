/**
 * §1.3 Phase 4 — pure invoice ↔ bank-deposit matcher.
 *
 * Given a set of issued invoices and a set of income bank
 * transactions for those invoices' issuing entity, return a plan:
 *
 *   - `proposedPayments` — one `InvoicePayment` row per (invoice, tx)
 *     pair the matcher is confident about.
 *   - `unmatchedInvoices` / `unmatchedTransactions` — leftovers the
 *     reconciler couldn't pair under the configured tolerances.
 *   - `notes` — structured reasons (`unresolved-fx`, `amount-out-of-tolerance`,
 *     `no-candidate`) that the route layer / Warnings tab can render.
 *
 * The matcher is **pure**: no DB access, no clock, no fs. The route
 * layer or a thin resolver loads invoices via the registry, hydrates
 * transactions via the existing DB helper, and hands them in. Same
 * shape used by `payment-outside-contract-window.ts`.
 *
 * Pairing reuses the global-greedy primitive in
 * `server/utils/payment-matcher.ts` ({@link pairBestMatches}). The
 * scorer here composes amount + date + narrative into a single number;
 * lower wins. Disqualified pairs (different entities, amounts past
 * tolerance, missing FX) return `null` from the scorer so they cannot
 * be matched.
 *
 * Cross-currency reconciliation: when `invoice.currency !== tx.currency`,
 * we accept the pair only when `invoice.fx_rate_at_issue` is set AND
 * `tx.currency === invoice.fx_base_currency`. The convention pinned
 * here is that `fx_rate_at_issue` expresses "1 unit of
 * `fx_base_currency` equals `fx_rate_at_issue` units of
 * `invoice.currency`", so a deposit in `fx_base_currency` converts via
 * `amountInInvoiceCurrency = tx.amount * fx_rate_at_issue`. Anything
 * else fails closed with an `unresolved-fx` note — Phase 4's job is to
 * land the same-currency 95% case (DC GBP, La Fosse GBP) confidently;
 * payment-time FX rates and tighter cross-currency drift detection can
 * follow once a rate provider exists.
 */

import type {
  Client,
  ClientId,
  Invoice,
  InvoicePayment,
  EntityId,
} from '../../../shared/api-contracts.js';
import { CurrencyCodeSchema } from '../../../shared/api-contracts.js';
import { daysBetween, todayIsoLocal } from '../../../shared/iso-date.js';
import {
  buildNarrativeTokens,
  narrativeMatches,
  normaliseForMatch,
} from '../clients/narrative-match.js';
import { pairBestMatches } from '../../utils/payment-matcher.js';

/** Bank-side row, projected into the minimum the matcher needs. */
export interface ReconcileTransaction {
  /** Stable id so the persisted `InvoicePayment` can FK back to the bank ledger. */
  readonly id: string;
  /** ISO `YYYY-MM-DD`. */
  readonly date: string;
  /** Positive means money in. Same sign convention as `transactions.csv`. */
  readonly amount: number;
  /**
   * ISO 4217 currency code of the deposit (derived from the account).
   * Typically `'GBP'` or `'AED'` — but the matcher accepts any string so
   * that "an unsupported currency lands here" can be detected and
   * surfaced as an `unresolved-fx` note rather than a type error.
   */
  readonly currency: string;
  /** `transactions.account` — used to gate by issuing entity at the call site. */
  readonly account: string;
  /** Free-text bank narrative — fed into the narrative scorer. */
  readonly description: string;
  /** Issuing entity that owns the receiving account. */
  readonly entityId: EntityId;
}

export interface ReconcileOptions {
  /** Max |tx.date - invoice.due_date| in days. Default 90. */
  readonly maxProximityDays?: number;
  /** Max |amountDelta| / invoice.total. Default 0.05 (5%). */
  readonly amountTolerance?: number;
  /**
   * `created_at` stamped on each `proposedPayment`. Default
   * `todayIsoLocal()`. Tests pin this to keep snapshots stable.
   */
  readonly now?: string;
}

export interface ReconciliationNote {
  readonly invoiceId: string;
  readonly transactionId?: string;
  readonly code:
    | 'unresolved-fx'
    | 'amount-out-of-tolerance'
    | 'date-out-of-window'
    | 'no-candidate';
  readonly detail: string;
}

export interface ReconciliationPlan {
  readonly proposedPayments: readonly InvoicePayment[];
  readonly unmatchedInvoices: readonly Invoice[];
  readonly unmatchedTransactions: readonly ReconcileTransaction[];
  readonly notes: readonly ReconciliationNote[];
}

export interface PlanReconciliationInput {
  /** Pre-filtered to `status === 'issued'` (or whatever the caller wants reconciled). */
  readonly invoices: readonly Invoice[];
  readonly transactions: readonly ReconcileTransaction[];
  readonly clientsById: ReadonlyMap<ClientId, Client>;
  /** Already-persisted payments (so partial / repeat deposits don't double-claim). */
  readonly existingPayments: readonly InvoicePayment[];
  readonly options?: ReconcileOptions;
}

const DEFAULT_MAX_PROXIMITY_DAYS = 90;
const DEFAULT_AMOUNT_TOLERANCE = 0.05;
/** Days-of-drift weight relative to amount — keeps amount the dominant signal. */
const DATE_WEIGHT = 1 / 30;
/** Bonus subtracted from a pair's score when the bank narrative names the client. */
const NARRATIVE_BONUS = 0.001;

/**
 * Build a deterministic reconciliation plan from invoices + bank
 * transactions. Output ordering is deterministic so route tests can
 * snapshot it.
 */
export function planReconciliation(
  input: PlanReconciliationInput,
): ReconciliationPlan {
  const maxProximityDays =
    input.options?.maxProximityDays ?? DEFAULT_MAX_PROXIMITY_DAYS;
  const amountTolerance =
    input.options?.amountTolerance ?? DEFAULT_AMOUNT_TOLERANCE;
  const createdAt = input.options?.now ?? todayIsoLocal();

  const residualByInvoice = computeResidualByInvoice(
    input.invoices,
    input.existingPayments,
  );
  const matchableInvoices = input.invoices.filter(
    inv => (residualByInvoice.get(inv.id) ?? 0) > 0,
  );

  const claimedTxIds = new Set(
    input.existingPayments.map(p => p.bank_transaction_id),
  );
  const matchableTransactions = input.transactions.filter(
    tx => !claimedTxIds.has(tx.id),
  );

  const notes: ReconciliationNote[] = [];

  const matches = pairBestMatches<Invoice, ReconcileTransaction>({
    slots: matchableInvoices,
    payments: matchableTransactions,
    score: (invoice, tx) => {
      const reason = scorePair(invoice, tx, {
        residual: residualByInvoice.get(invoice.id) ?? 0,
        amountTolerance,
        maxProximityDays,
        clientsById: input.clientsById,
      });
      if (reason.kind === 'disqualified') {
        notes.push({
          invoiceId: invoice.id,
          transactionId: tx.id,
          code: reason.code,
          detail: reason.detail,
        });
        return null;
      }
      return reason.score;
    },
    tieBreaker: (invoice, tx) => `${tx.date}|${invoice.id}|${tx.id}`,
    slotKey: invoice => invoice.id,
  });

  const proposedPayments: InvoicePayment[] = [];
  const matchedTxIds = new Set<string>();
  const matchedInvoiceIds = new Set<string>();

  for (const invoice of matchableInvoices) {
    const tx = matches.get(invoice.id);
    if (tx === null || tx === undefined) {
      notes.push({
        invoiceId: invoice.id,
        code: 'no-candidate',
        detail: `No bank deposit qualified within ±${maxProximityDays} days / ${formatPercent(amountTolerance)} of invoice ${invoice.id}.`,
      });
      continue;
    }
    matchedInvoiceIds.add(invoice.id);
    matchedTxIds.add(tx.id);

    const residual = residualByInvoice.get(invoice.id) ?? 0;
    const conversion = convertToInvoiceCurrency(invoice, tx);
    if (conversion === null) {
      // Should not happen — scorer disqualifies missing-FX pairs upstream.
      notes.push({
        invoiceId: invoice.id,
        transactionId: tx.id,
        code: 'unresolved-fx',
        detail: `Internal error: matched ${tx.id} to ${invoice.id} but FX is unresolved.`,
      });
      continue;
    }

    proposedPayments.push(
      buildPayment({
        invoice,
        tx,
        amountInInvoiceCurrency: conversion.amountInInvoiceCurrency,
        fxRateAtPayment: conversion.fxRateAtPayment,
        residualBefore: residual,
        createdAt,
      }),
    );
  }

  const unmatchedInvoices = matchableInvoices.filter(
    inv => !matchedInvoiceIds.has(inv.id),
  );
  const unmatchedTransactions = matchableTransactions.filter(
    tx => !matchedTxIds.has(tx.id),
  );

  return {
    proposedPayments,
    unmatchedInvoices,
    unmatchedTransactions,
    notes,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ScoreContext {
  readonly residual: number;
  readonly amountTolerance: number;
  readonly maxProximityDays: number;
  readonly clientsById: ReadonlyMap<ClientId, Client>;
}

type ScoreReason =
  | { readonly kind: 'qualified'; readonly score: number }
  | {
      readonly kind: 'disqualified';
      readonly code: ReconciliationNote['code'];
      readonly detail: string;
    };

function scorePair(
  invoice: Invoice,
  tx: ReconcileTransaction,
  ctx: ScoreContext,
): ScoreReason {
  if (tx.entityId !== invoice.issuing_entity_id) {
    // Different-entity pairs aren't candidates at all; signal silently
    // (no note) — the per-entity gate is part of the matcher's design,
    // not a user-facing anomaly.
    return {
      kind: 'disqualified',
      code: 'no-candidate',
      detail: `Transaction ${tx.id} belongs to entity ${tx.entityId}, invoice ${invoice.id} belongs to ${invoice.issuing_entity_id}.`,
    };
  }
  if (tx.amount <= 0) {
    return {
      kind: 'disqualified',
      code: 'no-candidate',
      detail: `Transaction ${tx.id} is not a positive deposit.`,
    };
  }

  const conversion = convertToInvoiceCurrency(invoice, tx);
  if (conversion === null) {
    return {
      kind: 'disqualified',
      code: 'unresolved-fx',
      detail: `Invoice ${invoice.id} is in ${invoice.currency} but deposit ${tx.id} is in ${tx.currency} and no fx_rate_at_issue is recorded.`,
    };
  }

  const dateDistance = Math.abs(daysBetween(tx.date, invoice.due_date));
  if (dateDistance > ctx.maxProximityDays) {
    return {
      kind: 'disqualified',
      code: 'date-out-of-window',
      detail: `Deposit ${tx.id} on ${tx.date} is ${dateDistance} days from invoice ${invoice.id} due ${invoice.due_date}; cap is ±${ctx.maxProximityDays}.`,
    };
  }

  const target = ctx.residual > 0 ? ctx.residual : invoice.total;
  if (target <= 0) {
    return {
      kind: 'disqualified',
      code: 'no-candidate',
      detail: `Invoice ${invoice.id} has no outstanding residual to match against.`,
    };
  }

  const amountFraction =
    Math.abs(conversion.amountInInvoiceCurrency - target) / target;
  if (amountFraction > ctx.amountTolerance) {
    return {
      kind: 'disqualified',
      code: 'amount-out-of-tolerance',
      detail: `Deposit ${tx.id} (${formatMoney(conversion.amountInInvoiceCurrency, invoice.currency)}) differs ${formatPercent(amountFraction)} from invoice ${invoice.id} target (${formatMoney(target, invoice.currency)}); tolerance ±${formatPercent(ctx.amountTolerance)}.`,
    };
  }

  const client = ctx.clientsById.get(invoice.client_id);
  const narrativeBoost = client !== undefined && hasNarrativeMatch(client, invoice, tx)
    ? -NARRATIVE_BONUS
    : 0;

  // Amount is the dominant signal; date adds at most ~3 over a 90-day
  // window; narrative is a small tie-breaker so two equal-amount, equal-date
  // candidates fall toward the one whose statement actually mentions the
  // payer or invoice number.
  const score =
    amountFraction +
    dateDistance * DATE_WEIGHT +
    narrativeBoost;

  return { kind: 'qualified', score };
}

function hasNarrativeMatch(
  client: Client,
  invoice: Invoice,
  tx: ReconcileTransaction,
): boolean {
  if (narrativeMatches(tx.description, buildNarrativeTokens(client))) return true;
  const haystack = normaliseForMatch(tx.description);
  if (haystack.length === 0) return false;
  const ref = normaliseForMatch(invoice.payment_reference);
  if (ref.length > 0 && haystack.includes(ref)) return true;
  const num = normaliseForMatch(invoice.invoice_number);
  if (num.length > 0 && haystack.includes(num)) return true;
  return false;
}

interface CurrencyConversion {
  readonly amountInInvoiceCurrency: number;
  readonly fxRateAtPayment: number | null;
}

/**
 * Convert `tx.amount` (deposit currency) into the invoice's currency.
 *
 * Same-currency deposits are 1:1. Cross-currency requires both:
 *   - `invoice.fx_rate_at_issue` set (positive),
 *   - `invoice.fx_base_currency === tx.currency`.
 *
 * Under that convention, `fx_rate_at_issue` is "units of
 * `invoice.currency` per 1 unit of `fx_base_currency`", so the
 * conversion is `tx.amount * fx_rate_at_issue`. Phase 4 reuses the
 * issue-time rate as the payment-time rate (distinct payment FX
 * snapshots can land later); `fx_gain_loss` is therefore zero by
 * construction here.
 */
function convertToInvoiceCurrency(
  invoice: Invoice,
  tx: ReconcileTransaction,
): CurrencyConversion | null {
  if (tx.currency === invoice.currency) {
    return { amountInInvoiceCurrency: round2(tx.amount), fxRateAtPayment: null };
  }
  const rate = invoice.fx_rate_at_issue;
  if (rate === null || rate <= 0) return null;
  if (invoice.fx_base_currency !== tx.currency) return null;
  return {
    amountInInvoiceCurrency: round2(tx.amount * rate),
    fxRateAtPayment: rate,
  };
}

interface BuildPaymentInput {
  readonly invoice: Invoice;
  readonly tx: ReconcileTransaction;
  readonly amountInInvoiceCurrency: number;
  readonly fxRateAtPayment: number | null;
  readonly residualBefore: number;
  readonly createdAt: string;
}

function buildPayment(input: BuildPaymentInput): InvoicePayment {
  const { invoice, tx, amountInInvoiceCurrency, fxRateAtPayment, residualBefore, createdAt } = input;
  const fxGainLoss =
    fxRateAtPayment === null || invoice.fx_rate_at_issue === null
      ? 0
      : round2(amountInInvoiceCurrency - tx.amount * invoice.fx_rate_at_issue);
  const residual = round2(residualBefore - amountInInvoiceCurrency);

  // By the time we reach this builder, scoring has already rejected any
  // deposit whose currency isn't a supported `CurrencyCode` (the
  // unresolved-fx gate fires upstream). Validate via Zod for safety.
  const depositCurrency = CurrencyCodeSchema.parse(tx.currency);

  return {
    id: `ip-${invoice.id}-${tx.id}`,
    invoice_id: invoice.id,
    bank_transaction_id: tx.id,
    payment_date: tx.date,
    amount_paid: round2(tx.amount),
    deposit_currency: depositCurrency,
    fx_rate_at_payment: fxRateAtPayment,
    amount_in_invoice_currency: amountInInvoiceCurrency,
    fx_gain_loss: fxGainLoss,
    residual,
    created_at: createdAt,
    updated_at: null,
  };
}

function computeResidualByInvoice(
  invoices: readonly Invoice[],
  existing: readonly InvoicePayment[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const inv of invoices) out.set(inv.id, inv.total);
  for (const p of existing) {
    const current = out.get(p.invoice_id);
    if (current === undefined) continue;
    out.set(p.invoice_id, round2(current - p.amount_in_invoice_currency));
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}
