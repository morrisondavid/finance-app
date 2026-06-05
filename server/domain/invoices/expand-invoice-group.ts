/**
 * Expand a seed invoice group until residual sum matches a deposit amount.
 */

import type { Invoice } from '../../../shared/api-contracts.js';

const MAX_SUBSET_CANDIDATES = 14;

export function amountWithinTolerance(
  actual: number,
  expected: number,
  toleranceFraction: number,
): boolean {
  if (expected <= 0) return false;
  return Math.abs(actual - expected) / expected <= toleranceFraction;
}

/** Greedy expansion (deterministic) — mirrors legacy La Fosse ingest behaviour. */
export function expandCandidatesGreedy(
  seed: readonly Invoice[],
  pool: readonly Invoice[],
  targetAmount: number,
  toleranceFraction: number,
  amountFor: (invoice: Invoice) => number = inv => inv.total,
): readonly Invoice[] {
  if (seed.length === 0) return seed;
  const chosen = new Map(seed.map(inv => [inv.id, inv] as const));
  let total = [...chosen.values()].reduce((sum, inv) => sum + amountFor(inv), 0);
  if (amountWithinTolerance(total, targetAmount, toleranceFraction)) {
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
    if (nextTotal - targetAmount > targetAmount * toleranceFraction) continue;
    chosen.set(inv.id, inv);
    total = nextTotal;
    if (amountWithinTolerance(total, targetAmount, toleranceFraction)) {
      return [...chosen.values()];
    }
  }

  return seed;
}

function enumerateExactSubsets(
  candidates: readonly Invoice[],
  targetAmount: number,
  toleranceFraction: number,
  maxResults: number,
  amountFor: (invoice: Invoice) => number,
): readonly (readonly Invoice[])[] {
  const results: Invoice[][] = [];
  const n = Math.min(candidates.length, MAX_SUBSET_CANDIDATES);

  const search = (start: number, picked: Invoice[], sum: number): void => {
    if (results.length >= maxResults) return;
    if (amountWithinTolerance(sum, targetAmount, toleranceFraction) && picked.length > 0) {
      results.push([...picked]);
      if (results.length >= maxResults) return;
    }
    for (let i = start; i < n; i++) {
      const inv = candidates[i]!;
      const nextSum = sum + amountFor(inv);
      if (nextSum > targetAmount * (1 + toleranceFraction)) continue;
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
 * Find a unique invoice combination whose totals match `targetAmount`.
 * Returns `ambiguous` when more than one exact subset exists.
 */
export function resolveExpandedInvoiceGroup(input: {
  readonly seed: readonly Invoice[];
  readonly pool: readonly Invoice[];
  readonly targetAmount: number;
  readonly toleranceFraction: number;
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
  const greedy = expandCandidatesGreedy(
    input.seed,
    input.pool,
    input.targetAmount,
    input.toleranceFraction,
    amountFor,
  );
  const greedyTotal = greedy.reduce((sum, inv) => sum + amountFor(inv), 0);
  if (amountWithinTolerance(greedyTotal, input.targetAmount, input.toleranceFraction)) {
    const exactSubsets = enumerateExactSubsets(
      input.pool.filter(inv =>
        greedy.some(g => g.id === inv.id)
        || input.seed.some(s => s.id === inv.id),
      ),
      input.targetAmount,
      input.toleranceFraction,
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

  const sortedPool = [...input.pool].sort((a, b) => {
    const periodCmp = a.period_start.localeCompare(b.period_start);
    if (periodCmp !== 0) return periodCmp;
    return a.id.localeCompare(b.id);
  });
  const exactSubsets = enumerateExactSubsets(
    sortedPool,
    input.targetAmount,
    input.toleranceFraction,
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
