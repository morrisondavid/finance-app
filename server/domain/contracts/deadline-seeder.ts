/**
 * Contract-renewal deadline seeder.
 *
 * For every active contract with a defined `end_date`, ensure a matching
 * deadline exists in the deadlines table with:
 *
 *   - id       = `contract-renewal-${contract.id}`
 *   - type     = `'contract-renewal'`
 *   - dueDate  = `end_date - renewal_warning_days`
 *   - title    = `${client.trading_name} renewal (${contract.reference})`
 *
 * Contracts with `end_date === null` (open-ended masters, rolling
 * engagements) are skipped — there's no concrete warning date to seed.
 *
 * This seeder is idempotent: repeated calls converge to the same set of
 * deadlines. See `upsertDeadline` for the write semantics — crucially,
 * user-marked-done deadlines are NOT reopened by a re-seed.
 *
 * Wire-up: called once at server startup (after the CSV → SQLite
 * projection is rebuilt) and again from `upsertContract` after a write.
 */

import { shiftIsoDate } from '../../../shared/iso-date.js';
import { upsertDeadline } from '../../db/repositories/deadlines.js';
import { getClientRegistry, type ClientRegistry } from '../clients/registry.js';
import type { Contract } from './schema.js';
import { getContractRegistry, type ContractRegistry } from './registry.js';

export interface SyncContractRenewalDeadlinesInput {
  readonly contracts?: ContractRegistry;
  readonly clients?: ClientRegistry;
}

/**
 * Return the deterministic deadline id for a contract's renewal
 * warning. Exposed so tests can assert against it without duplicating
 * the formatter.
 */
export function contractRenewalDeadlineId(contract: Contract): string {
  return `contract-renewal-${contract.id}`;
}

/**
 * Compose the human-readable title for a contract-renewal deadline.
 * Uses the client's `trading_name` (short, UI-friendly) and the
 * contract `reference` (the identifier the user sees on paperwork).
 */
export function contractRenewalDeadlineTitle(
  contract: Contract,
  clientTradingName: string,
): string {
  return `${clientTradingName} renewal (${contract.reference})`;
}

/**
 * Run the seeder. Safe to call repeatedly.
 *
 * Returns the list of deadline ids that were seeded or re-seeded this
 * run, so callers can log them / show a startup banner.
 */
export function syncContractRenewalDeadlines(
  input: SyncContractRenewalDeadlinesInput = {},
): readonly string[] {
  const contracts = input.contracts ?? getContractRegistry();
  const clients = input.clients ?? getClientRegistry();

  const seeded: string[] = [];

  for (const contract of contracts.indexes.active) {
    if (contract.end_date === null) continue;

    const client = clients.indexes.byId.get(contract.client_id);
    if (client === undefined) {
      // FK validation would normally prevent this; belt-and-braces.
      continue;
    }

    const dueDate = shiftIsoDate(contract.end_date, -contract.renewal_warning_days);
    const id = contractRenewalDeadlineId(contract);
    const title = contractRenewalDeadlineTitle(contract, client.trading_name);

    upsertDeadline({
      id,
      type: 'contract-renewal',
      title,
      dueDate,
      recurrence: 'one-off',
      notes: null,
      url: null,
    });
    seeded.push(id);
  }

  return seeded;
}
