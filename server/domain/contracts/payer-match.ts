/**
 * Timeline-aware payer → contract matcher.
 *
 * Given a deposit transaction on one of our business accounts, answer
 * the three-way question:
 *
 *   1. Is the narrative recognisably from one of our known clients? If
 *      not, return `no-known-payer` — the warnings layer ignores it.
 *   2. Yes. Do we have an active contract with that client on the
 *      issuing entity that owns the receiving account, covering the
 *      transaction's date? Yes → `in-contract` — nothing to warn about.
 *   3. Yes / no contract on that date. → `outside-contract-window`,
 *      pinned to the `nearestContract` so the warning message can say
 *      *"Nearest: lf-2026-mar ended 2026-04-30."*
 *
 * The narrative helpers live in `server/domain/clients/narrative-match.ts`
 * so every "recognise this client" feature (`findLastInvoicePaymentDate`,
 * this matcher, future reconciler) normalises identically.
 *
 * The contract-window lookup leans on `findContractForTransaction` +
 * the `byClientAndEntity` registry index — both exposed by the contracts
 * registry. No new indexing is needed.
 */

import type {
  Client,
  Contract,
  EntityId,
  Transaction,
} from '../../../shared/api-contracts.js';
import {
  buildNarrativeTokens,
  narrativeMatches,
} from '../clients/narrative-match.js';
import { findContractForTransaction } from './queries.js';
import { getContractRegistry, type ContractRegistry } from './registry.js';
import { getClientRegistry, type ClientRegistry } from '../clients/registry.js';

export type PayerMatchResult =
  | { readonly kind: 'in-contract'; readonly contract: Contract }
  | {
      readonly kind: 'outside-contract-window';
      readonly client: Client;
      readonly nearestContract: Contract;
    }
  | { readonly kind: 'no-known-payer' }
  | { readonly kind: 'no-contracts-for-entity'; readonly client: Client };

export interface MatchPayerToContractInput {
  readonly transaction: Transaction;
  readonly accountEntityId: EntityId;
  /** Override registries for tests; defaults to the live singletons. */
  readonly contractRegistry?: ContractRegistry;
  readonly clientRegistry?: ClientRegistry;
}

/**
 * Core matcher. Pure w.r.t. the passed registries; defaults to the live
 * singletons for the route layer.
 */
export function matchPayerToContract(
  input: MatchPayerToContractInput,
): PayerMatchResult {
  const clients = input.clientRegistry ?? getClientRegistry();
  const contracts = input.contractRegistry ?? getContractRegistry();

  const matchedClient = findPayerClient(input.transaction.description, clients);
  if (matchedClient === null) return { kind: 'no-known-payer' };

  const active = findContractForTransaction(
    {
      clientId: matchedClient.id,
      issuingEntityId: input.accountEntityId,
      date: input.transaction.date,
    },
    contracts,
  );
  if (active !== null) return { kind: 'in-contract', contract: active };

  const series = contracts.indexes.byClientAndEntity.get(
    `${matchedClient.id}|${input.accountEntityId}`,
  );
  if (series === undefined || series.length === 0) {
    return { kind: 'no-contracts-for-entity', client: matchedClient };
  }

  const nearest = nearestByDateGap(series, input.transaction.date);
  return {
    kind: 'outside-contract-window',
    client: matchedClient,
    nearestContract: nearest,
  };
}

/**
 * Walk every client's narrative tokens; first hit wins. `null` when no
 * client's trading name appears in the description.
 */
function findPayerClient(
  description: string,
  registry: ClientRegistry,
): Client | null {
  for (const client of registry.all) {
    const tokens = buildNarrativeTokens(client);
    if (narrativeMatches(description, tokens)) return client;
  }
  return null;
}

/**
 * Closest contract to `date` by start/end boundary gap. Used only when
 * no contract covers the date, so at least one of `start_date > date`
 * or `end_date < date` holds for every candidate.
 */
function nearestByDateGap(
  series: readonly Contract[],
  date: string,
): Contract {
  let best: Contract | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const c of series) {
    const gap = contractGapDays(c, date);
    if (gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  // `series.length === 0` is guarded by the caller — this is never null
  // in practice. Guard for the type checker only.
  if (best === null) return series[0];
  return best;
}

function contractGapDays(contract: Contract, date: string): number {
  if (date < contract.start_date) {
    return dayDiff(contract.start_date, date);
  }
  if (date > contract.end_date) {
    return dayDiff(date, contract.end_date);
  }
  return 0;
}

function dayDiff(later: string, earlier: string): number {
  const a = Date.UTC(
    Number(later.slice(0, 4)),
    Number(later.slice(5, 7)) - 1,
    Number(later.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(earlier.slice(0, 4)),
    Number(earlier.slice(5, 7)) - 1,
    Number(earlier.slice(8, 10)),
  );
  return Math.round((a - b) / 86_400_000);
}
