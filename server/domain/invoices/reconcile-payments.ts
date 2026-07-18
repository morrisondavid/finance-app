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
import {
  INVOICE_AMOUNT_EPSILON,
  resolveExpandedInvoiceGroup,
} from './expand-invoice-group.js';
import {
  buildReferenceIndex,
  findReferencedInvoices,
  referenceIndexKeys,
} from './reference-match.js';

/** Bank-side row, projected into the minimum the matcher needs. */
export interface ReconcileTransaction {
  /**
   * Stable identity of the bank transaction — the content `hash` from the
   * ledger, NOT the volatile autoincrement `transactions.id`. The hash is
   * what gets persisted as `InvoicePayment.bank_transaction_id`, so links
   * survive a feed re-sync (which reassigns autoincrement ids).
   */
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

export type MatchConfidence = 'reference-exact' | 'amount-only';

export interface ReconcileOptions {
  /** Max |tx.date - invoice.due_date| in days. Default 90. */
  readonly maxProximityDays?: number;
  /**
   * Max |amountDelta| / invoice.total for **cross-currency** pairs converted
   * via `fx_rate_at_issue`. Default 0.05 (5%). Same-currency payments always
   * match exactly (±£0.01) — invoice payments carry no percentage tolerance.
   */
  readonly amountTolerance?: number;
  /**
   * `created_at` stamped on each `proposedPayment`. Default
   * `todayIsoLocal()`. Tests pin this to keep snapshots stable.
   */
  readonly now?: string;
  /**
   * Deposit amount used for tolerance checks (e.g. GBP leg quoted in an
   * AED narrative). Defaults to `tx.amount`.
   */
  readonly resolveDepositAmount?: (tx: ReconcileTransaction) => number;
}

export interface ReconciliationNote {
  readonly invoiceId: string;
  readonly transactionId?: string;
  readonly code:
    | 'unresolved-fx'
    | 'amount-out-of-tolerance'
    | 'date-out-of-window'
    | 'no-candidate'
    | 'reference-amount-mismatch'
    | 'reference-ambiguous';
  readonly detail: string;
}

export interface ReferenceCitedDepositIssue {
  readonly transaction: ReconcileTransaction;
  readonly code: 'reference-amount-mismatch' | 'reference-ambiguous';
  readonly citedInvoiceIds: readonly string[];
  readonly detail: string;
}

export interface ReconciliationPlan {
  readonly proposedPayments: readonly InvoicePayment[];
  readonly paymentConfidence: ReadonlyMap<string, MatchConfidence>;
  readonly referenceCitedIssues: readonly ReferenceCitedDepositIssue[];
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
/** Cross-currency (FX) tolerance only — same-currency matches are exact. */
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
  const resolveDepositAmount =
    input.options?.resolveDepositAmount ?? (tx => tx.amount);

  const residualByInvoice = computeResidualByInvoice(
    input.invoices,
    input.existingPayments,
  );
  const matchableInvoices = input.invoices.filter(
    inv => (residualByInvoice.get(inv.id) ?? 0) > 0,
  );

  const existingPairs = new Set(
    input.existingPayments.map(p => `${p.invoice_id}|${p.bank_transaction_id}`),
  );

  const settledBankTxIds = new Set(
    input.existingPayments.map(p => p.bank_transaction_id),
  );

  const referenceIndex = buildReferenceIndex(matchableInvoices);
  const sortedIndexKeys = referenceIndexKeys(referenceIndex);
  const clientsByEntity = clientsWithInvoicesForEntity(
    input.invoices,
    input.clientsById,
  );

  const matchableTransactions = input.transactions.filter(tx =>
    isInvoiceReconcilableDeposit({
      tx,
      settledBankTxIds,
      allTransactions: input.transactions,
      clientsById: input.clientsById,
      clientsForEntity: clientsByEntity.get(tx.entityId) ?? [],
      referenceIndex,
      sortedIndexKeys,
    }),
  );

  const notes: ReconciliationNote[] = [];
  const paymentConfidence = new Map<string, MatchConfidence>();
  const referenceCitedIssues: ReferenceCitedDepositIssue[] = [];

  const batchResult = planReferenceBatchMatches({
    matchableInvoices,
    transactions: matchableTransactions,
    residualByInvoice,
    existingPairs,
    referenceIndex,
    sortedIndexKeys,
    maxProximityDays,
    resolveDepositAmount,
    createdAt,
    notes,
    referenceCitedIssues,
    paymentConfidence,
  });

  const remainingInvoices = matchableInvoices.filter(
    inv => !batchResult.matchedInvoiceIds.has(inv.id),
  );
  const remainingTransactions = matchableTransactions.filter(
    tx => !batchResult.matchedTxIds.has(tx.id),
  );

  const matches = pairBestMatches<Invoice, ReconcileTransaction>({
    slots: remainingInvoices,
    payments: remainingTransactions,
    score: (invoice, tx) => {
      if (existingPairs.has(`${invoice.id}|${tx.id}`)) {
        return null;
      }
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

  const proposedPayments: InvoicePayment[] = [...batchResult.payments];
  const matchedTxIds = new Set<string>(batchResult.matchedTxIds);
  const matchedInvoiceIds = new Set<string>(batchResult.matchedInvoiceIds);

  for (const invoice of remainingInvoices) {
    const tx = matches.get(invoice.id);
    if (tx === null || tx === undefined) {
      notes.push({
        invoiceId: invoice.id,
        code: 'no-candidate',
        detail: `No bank deposit qualified within ±${maxProximityDays} days of invoice ${invoice.id} (exact amount; FX tolerance ${formatPercent(amountTolerance)}).`,
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

    const payment = buildPayment({
      invoice,
      tx,
      amountInInvoiceCurrency: conversion.amountInInvoiceCurrency,
      fxRateAtPayment: conversion.fxRateAtPayment,
      residualBefore: residual,
      createdAt,
    });
    proposedPayments.push(payment);
    paymentConfidence.set(payment.id, 'amount-only');
  }

  const unmatchedInvoices = matchableInvoices.filter(
    inv => !matchedInvoiceIds.has(inv.id),
  );
  const unmatchedTransactions = matchableTransactions.filter(
    tx => !matchedTxIds.has(tx.id),
  );

  return {
    proposedPayments,
    paymentConfidence,
    referenceCitedIssues,
    unmatchedInvoices,
    unmatchedTransactions,
    notes,
  };
}

interface ReferenceBatchMatchInput {
  readonly matchableInvoices: readonly Invoice[];
  readonly transactions: readonly ReconcileTransaction[];
  readonly residualByInvoice: ReadonlyMap<string, number>;
  readonly existingPairs: Set<string>;
  readonly referenceIndex: ReadonlyMap<string, readonly Invoice[]>;
  readonly sortedIndexKeys: readonly string[];
  readonly maxProximityDays: number;
  readonly resolveDepositAmount: (tx: ReconcileTransaction) => number;
  readonly createdAt: string;
  readonly notes: ReconciliationNote[];
  readonly referenceCitedIssues: ReferenceCitedDepositIssue[];
  readonly paymentConfidence: Map<string, MatchConfidence>;
}

interface ReferenceBatchMatchResult {
  readonly payments: readonly InvoicePayment[];
  readonly matchedInvoiceIds: ReadonlySet<string>;
  readonly matchedTxIds: ReadonlySet<string>;
}

function residualAmount(
  invoice: Invoice,
  residualByInvoice: ReadonlyMap<string, number>,
): number {
  return residualByInvoice.get(invoice.id) ?? invoice.total;
}

function invoiceWithinDateWindow(
  invoice: Invoice,
  tx: ReconcileTransaction,
  maxProximityDays: number,
): boolean {
  return Math.abs(daysBetween(tx.date, invoice.due_date)) <= maxProximityDays;
}

function planReferenceBatchMatches(
  input: ReferenceBatchMatchInput,
): ReferenceBatchMatchResult {
  const payments: InvoicePayment[] = [];
  const matchedInvoiceIds = new Set<string>();
  const matchedTxIds = new Set<string>();

  for (const tx of input.transactions) {
    const lookup = findReferencedInvoices(
      tx.description,
      input.referenceIndex,
      input.sortedIndexKeys,
    );

    if (lookup.kind === 'ambiguous') {
      input.referenceCitedIssues.push({
        transaction: tx,
        code: 'reference-ambiguous',
        citedInvoiceIds: [],
        detail: lookup.detail,
      });
      input.notes.push({
        invoiceId: '*',
        transactionId: tx.id,
        code: 'reference-ambiguous',
        detail: lookup.detail,
      });
      continue;
    }

    if (lookup.kind === 'none') {
      continue;
    }

    const depositAmount = input.resolveDepositAmount(tx);
    const seed = lookup.invoices.filter(inv => {
      if (inv.issuing_entity_id !== tx.entityId) return false;
      if (residualAmount(inv, input.residualByInvoice) <= 0) return false;
      if (input.existingPairs.has(`${inv.id}|${tx.id}`)) return false;
      if (!invoiceWithinDateWindow(inv, tx, input.maxProximityDays)) return false;
      return true;
    });

    if (seed.length === 0) {
      continue;
    }

    const clientId = seed[0]!.client_id;
    const pool = input.matchableInvoices.filter(inv => {
      // Paid-but-unlinked (drift) invoices may only join a batch when the
      // narrative cites them (seed); they must not be pulled in as filler.
      if (inv.status === 'paid' && !seed.some(s => s.id === inv.id)) return false;
      if (inv.client_id !== clientId) return false;
      if (inv.issuing_entity_id !== tx.entityId) return false;
      if (residualAmount(inv, input.residualByInvoice) <= 0) return false;
      if (input.existingPairs.has(`${inv.id}|${tx.id}`)) return false;
      if (!invoiceWithinDateWindow(inv, tx, input.maxProximityDays)) return false;
      if (matchedInvoiceIds.has(inv.id)) return false;
      return true;
    });

    const amountFor = (invoice: Invoice) =>
      residualAmount(invoice, input.residualByInvoice);

    const expanded = resolveExpandedInvoiceGroup({
      seed,
      pool,
      targetAmount: depositAmount,
      amountFor,
    });

    if (expanded.kind === 'ambiguous') {
      input.referenceCitedIssues.push({
        transaction: tx,
        code: 'reference-ambiguous',
        citedInvoiceIds: seed.map(inv => inv.id),
        detail: expanded.detail,
      });
      input.notes.push({
        invoiceId: seed.map(inv => inv.id).join(','),
        transactionId: tx.id,
        code: 'reference-ambiguous',
        detail: expanded.detail,
      });
      continue;
    }

    if (expanded.kind === 'no-match') {
      const expected = seed.reduce((sum, inv) => sum + amountFor(inv), 0);
      const detail =
        `Deposit cites ${seed.map(inv => inv.payment_reference).join(', ')} `
        + `but residual sum ${expected.toFixed(2)} does not match deposit `
        + `${depositAmount.toFixed(2)}.`;
      input.referenceCitedIssues.push({
        transaction: tx,
        code: 'reference-amount-mismatch',
        citedInvoiceIds: seed.map(inv => inv.id),
        detail,
      });
      for (const inv of seed) {
        input.notes.push({
          invoiceId: inv.id,
          transactionId: tx.id,
          code: 'reference-amount-mismatch',
          detail,
        });
      }
      continue;
    }

    const group = expanded.invoices;
    const groupResidual = group.reduce((sum, inv) => sum + amountFor(inv), 0);
    // The expansion only returns groups whose residual sum equals the deposit
    // to the penny, so every batch match is reference-exact by construction.
    const confidence: MatchConfidence = 'reference-exact';

    for (const invoice of group) {
      const residualBefore = amountFor(invoice);
      const share = groupResidual > 0 ? residualBefore / groupResidual : 0;
      const amountPaid = depositAmount * share;
      const conversion = convertToInvoiceCurrency(invoice, {
        ...tx,
        amount: amountPaid,
      });
      if (conversion === null) {
        input.notes.push({
          invoiceId: invoice.id,
          transactionId: tx.id,
          code: 'unresolved-fx',
          detail: `Reference batch for ${tx.id} cannot convert ${invoice.id}.`,
        });
        continue;
      }

      const payment = buildPayment({
        invoice,
        tx,
        amountInInvoiceCurrency: residualBefore,
        fxRateAtPayment: conversion.fxRateAtPayment,
        residualBefore,
        createdAt: input.createdAt,
        amountPaidOverride: round2(amountPaid),
      });
      payments.push(payment);
      input.paymentConfidence.set(payment.id, confidence);
      matchedInvoiceIds.add(invoice.id);
      input.existingPairs.add(`${invoice.id}|${tx.id}`);
    }
    matchedTxIds.add(tx.id);
  }

  return { payments, matchedInvoiceIds, matchedTxIds };
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

  const amountDelta = Math.abs(conversion.amountInInvoiceCurrency - target);
  const amountFraction = amountDelta / target;
  if (tx.currency === invoice.currency) {
    // Same-currency payments must match to the penny — no percentage
    // tolerance on invoice payments. FX conversions are handled below.
    if (amountDelta > INVOICE_AMOUNT_EPSILON) {
      return {
        kind: 'disqualified',
        code: 'amount-out-of-tolerance',
        detail: `Deposit ${tx.id} (${formatMoney(conversion.amountInInvoiceCurrency, invoice.currency)}) does not equal invoice ${invoice.id} target (${formatMoney(target, invoice.currency)}); same-currency payments must match exactly.`,
      };
    }
  } else if (amountFraction > ctx.amountTolerance) {
    return {
      kind: 'disqualified',
      code: 'amount-out-of-tolerance',
      detail: `Deposit ${tx.id} (${formatMoney(conversion.amountInInvoiceCurrency, invoice.currency)}) differs ${formatPercent(amountFraction)} from invoice ${invoice.id} target (${formatMoney(target, invoice.currency)}); FX tolerance ±${formatPercent(ctx.amountTolerance)}.`,
    };
  }

  const client = ctx.clientsById.get(invoice.client_id);
  const narrativeMatched =
    client !== undefined && hasNarrativeMatch(client, invoice, tx);

  // Paid-but-unlinked (drift) invoices are only repairable when the deposit
  // narrative actually names the payer or cites the invoice — amount+date
  // alone would pair them with unrelated equal-amount deposits (e.g.
  // standing orders).
  if (invoice.status === 'paid' && !narrativeMatched) {
    return {
      kind: 'disqualified',
      code: 'no-candidate',
      detail: `Invoice ${invoice.id} is already marked paid; deposit ${tx.id} narrative does not name the payer or cite the invoice, so it cannot repair the missing payment link.`,
    };
  }

  const narrativeBoost = narrativeMatched ? -NARRATIVE_BONUS : 0;

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
  readonly amountPaidOverride?: number;
}

function buildPayment(input: BuildPaymentInput): InvoicePayment {
  const {
    invoice,
    tx,
    amountInInvoiceCurrency,
    fxRateAtPayment,
    residualBefore,
    createdAt,
    amountPaidOverride,
  } = input;
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
    amount_paid: amountPaidOverride ?? round2(tx.amount),
    deposit_currency: depositCurrency,
    fx_rate_at_payment: fxRateAtPayment,
    amount_in_invoice_currency: amountInInvoiceCurrency,
    fx_gain_loss: fxGainLoss,
    residual,
    created_at: createdAt,
    updated_at: null,
  };
}

/** Client invoice settlements are never micro-deposits (card FX legs, etc.). */
const MIN_INVOICE_DEPOSIT_AMOUNT = 1;

interface InvoiceReconcilableDepositInput {
  readonly tx: ReconcileTransaction;
  readonly settledBankTxIds: ReadonlySet<string>;
  readonly allTransactions: readonly ReconcileTransaction[];
  readonly clientsById: ReadonlyMap<ClientId, Client>;
  readonly clientsForEntity: readonly Client[];
  readonly referenceIndex: ReadonlyMap<string, readonly Invoice[]>;
  readonly sortedIndexKeys: readonly string[];
}

/** Clients that have at least one invoice for the entity. */
function clientsWithInvoicesForEntity(
  invoices: readonly Invoice[],
  clientsById: ReadonlyMap<ClientId, Client>,
): ReadonlyMap<EntityId, readonly Client[]> {
  const clientIdsByEntity = new Map<EntityId, Set<ClientId>>();
  for (const invoice of invoices) {
    const set = clientIdsByEntity.get(invoice.issuing_entity_id) ?? new Set<ClientId>();
    set.add(invoice.client_id);
    clientIdsByEntity.set(invoice.issuing_entity_id, set);
  }

  const out = new Map<EntityId, readonly Client[]>();
  for (const [entityId, clientIds] of clientIdsByEntity) {
    const clients = [...clientIds]
      .map(id => clientsById.get(id))
      .filter((client): client is Client => client !== undefined);
    out.set(entityId, clients);
  }
  return out;
}

function depositCitesKnownInvoiceReference(
  description: string,
  referenceIndex: ReadonlyMap<string, readonly Invoice[]>,
  sortedIndexKeys: readonly string[],
): boolean {
  return findReferencedInvoices(description, referenceIndex, sortedIndexKeys).kind !== 'none';
}

function depositNarrativeNamesClient(
  description: string,
  clients: readonly Client[],
): boolean {
  for (const client of clients) {
    if (narrativeMatches(description, buildNarrativeTokens(client))) {
      return true;
    }
  }
  return false;
}

function isInvoiceReconcilableDeposit(input: InvoiceReconcilableDepositInput): boolean {
  const { tx, settledBankTxIds, allTransactions } = input;
  if (tx.amount < MIN_INVOICE_DEPOSIT_AMOUNT) return false;
  if (settledBankTxIds.has(tx.id)) return false;
  if (/\bREFUND\b/i.test(tx.description)) return false;
  if (isDuplicateSettledRemittanceLeg(tx, settledBankTxIds, allTransactions)) {
    return false;
  }

  if (depositCitesKnownInvoiceReference(
    tx.description,
    input.referenceIndex,
    input.sortedIndexKeys,
  )) {
    return true;
  }

  return depositNarrativeNamesClient(tx.description, input.clientsForEntity);
}

/**
 * Barclays (and similar) often posts the same client remittance twice on one
 * date — transfer leg (TFR) plus credit leg (BG). When the sibling leg is
 * already linked in `invoice_payments.csv`, suppress the duplicate.
 */
function isDuplicateSettledRemittanceLeg(
  tx: ReconcileTransaction,
  settledBankTxIds: ReadonlySet<string>,
  allTransactions: readonly ReconcileTransaction[],
): boolean {
  if (settledBankTxIds.size === 0) return false;

  const payer = remittancePayerKey(tx.description);
  const refs = remittanceReferenceKeys(tx.description);

  for (const other of allTransactions) {
    if (other.id === tx.id || !settledBankTxIds.has(other.id)) continue;
    if (
      other.date !== tx.date
      || other.account !== tx.account
      || round2(other.amount) !== round2(tx.amount)
    ) {
      continue;
    }
    if (payer !== null && payer === remittancePayerKey(other.description)) {
      return true;
    }
    if (refs.length > 0 && remittanceReferenceKeys(other.description).some(
      key => refs.includes(key),
    )) {
      return true;
    }
  }
  return false;
}

function remittancePayerKey(description: string): string | null {
  const match = description.match(/\b(LA FOSSE|DELTA CAPITA)\b/i);
  return match?.[1]?.toLowerCase().replace(/\s+/g, ' ') ?? null;
}

function remittanceReferenceKeys(description: string): readonly string[] {
  const keys = new Set<string>();
  for (const match of description.matchAll(/SB\s*-?\s*(\d+)/gi)) {
    const digits = match[1];
    if (digits !== undefined && digits.length > 0) {
      keys.add(`sb-${digits}`);
    }
  }
  return [...keys];
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
