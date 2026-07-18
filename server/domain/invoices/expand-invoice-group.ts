/**
 * Expand a seed invoice group until residual sum matches a deposit amount.
 *
 * All amounts here are in the invoice currency (callers resolve the deposit
 * leg first, e.g. the GBP amount quoted in an AED narrative), so matching is
 * exact to the penny — invoice payments carry no percentage tolerance.
 */

import type { Invoice } from '../../../shared/api-contracts.js';

const MAX_SUBSET_CANDIDATES = 14;

function dedupeById(invoices: readonly Invoice[]): readonly Invoice[] {
  const byId = new Map(invoices.map(inv => [inv.id, inv] as const));
  return [...byId.values()];
}

/** Same-currency amounts must agree to the penny (round2 convention). */
export const INVOICE_AMOUNT_EPSILON = 0.01;

export function amountsMatchExactly(actual: number, expected: number): boolean {
  if (expected <= 0) return false;
  return Math.abs(actual - expected) <= INVOICE_AMOUNT_EPSILON;
}

/** Greedy expansion (deterministic) — mirrors legacy La Fosse ingest behaviour. */
export function expandCandidatesGreedy(
  seed: readonly Invoice[],
  pool: readonly Invoice[],
  targetAmount: number,
  amountFor: (invoice: Invoice) => number = inv => inv.total,
): readonly Invoice[] {
  if (seed.length === 0) return seed;
  const chosen = new Map(seed.map(inv => [inv.id, inv] as const));
  let total = [...chosen.values()].reduce((sum, inv) => sum + amountFor(inv), 0);
  if (amountsMatchExactly(total, targetAmount)) {
    return [...chosen.values()];
  }

  const remaining = pool
    .filter(inv => !chosen.has(inv.id))
    .sort((a, b) => {
      const periodCmp = a.period_start.localeCompare(b.period_start);
      if (periodCmp !== 0) return periodCmp;
      return a.id.localeCompare(b.id);
    });

  for (const inv of remaining) {
    const nextTotal = total + amountFor(inv);
    if (nextTotal - targetAmount > INVOICE_AMOUNT_EPSILON) continue;
    chosen.set(inv.id, inv);
    total = nextTotal;
    if (amountsMatchExactly(total, targetAmount)) {
      return [...chosen.values()];
    }
  }

  return seed;
}

function enumerateExactSubsets(
  candidates: readonly Invoice[],
  targetAmount: number,
  maxResults: number,
  amountFor: (invoice: Invoice) => number,
): readonly (readonly Invoice[])[] {
  const results: Invoice[][] = [];
  const n = Math.min(candidates.length, MAX_SUBSET_CANDIDATES);

  const search = (start: number, picked: Invoice[], sum: number): void => {
    if (results.length >= maxResults) return;
    if (amountsMatchExactly(sum, targetAmount) && picked.length > 0) {
      results.push([...picked]);
      if (results.length >= maxResults) return;
    }
    for (let i = start; i < n; i++) {
      const inv = candidates[i]!;
      const nextSum = sum + amountFor(inv);
      if (nextSum > targetAmount + INVOICE_AMOUNT_EPSILON) continue;
      picked.push(inv);
      search(i + 1, picked, nextSum);
      picked.pop();
      if (results.length >= maxResults) return;
    }
  };

  search(0, [], 0);
  return results;
}

/**
 * Find a unique invoice combination whose totals match `targetAmount`
 * exactly. Returns `ambiguous` when more than one exact subset exists.
 */
export function resolveExpandedInvoiceGroup(input: {
  readonly seed: readonly Invoice[];
  readonly pool: readonly Invoice[];
  readonly targetAmount: number;
  readonly amountFor?: (invoice: Invoice) => number;
}): {
  readonly kind: 'exact';
  readonly invoices: readonly Invoice[];
} | {
  readonly kind: 'ambiguous';
  readonly detail: string;
} | {
  readonly kind: 'no-match';
} {
  const amountFor = input.amountFor ?? (inv => inv.total);
  // Seed members may be absent from the pool (e.g. cited paid-drift
  // invoices), so candidate sets are always the explicit seed ∪ pool union.
  const poolWithSeed = dedupeById([...input.seed, ...input.pool]);
  const greedy = expandCandidatesGreedy(
    input.seed,
    input.pool,
    input.targetAmount,
    amountFor,
  );
  const greedyTotal = greedy.reduce((sum, inv) => sum + amountFor(inv), 0);
  if (amountsMatchExactly(greedyTotal, input.targetAmount)) {
    const exactSubsets = enumerateExactSubsets(
      poolWithSeed.filter(inv => greedy.some(g => g.id === inv.id)),
      input.targetAmount,
      2,
      amountFor,
    );
    if (exactSubsets.length > 1) {
      return {
        kind: 'ambiguous',
        detail: `Multiple invoice combinations match deposit amount ${input.targetAmount.toFixed(2)}.`,
      };
    }
    return { kind: 'exact', invoices: greedy };
  }

  const sortedPool = [...poolWithSeed].sort((a, b) => {
    const periodCmp = a.period_start.localeCompare(b.period_start);
    if (periodCmp !== 0) return periodCmp;
    return a.id.localeCompare(b.id);
  });
  const exactSubsets = enumerateExactSubsets(
    sortedPool,
    input.targetAmount,
    2,
    amountFor,
  );
  if (exactSubsets.length === 1) {
    return { kind: 'exact', invoices: exactSubsets[0]! };
  }
  if (exactSubsets.length > 1) {
    return {
      kind: 'ambiguous',
      detail: `Multiple invoice combinations match deposit amount ${input.targetAmount.toFixed(2)}.`,
    };
  }
  return { kind: 'no-match' };
}
