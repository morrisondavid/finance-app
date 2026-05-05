/**
 * Human-facing engagement labels — one place for client + date range text.
 * `Contract.reference` in CSV should normally match this or be a shorter custom title.
 */

import { formatIsoDateUkLong } from './formatting.js';

export interface ContractDisplayInput {
  readonly client_id: string;
  readonly start_date: string;
  readonly end_date: string | null;
}

export interface ClientDisplayInput {
  readonly trading_name: string;
}

/**
 * Canonical display line: `{trading_name} · {start}–{end | open-ended}` with
 * dates as `DD Mmm YYYY` (abbreviated month, UK-oriented via {@link formatIsoDateUkLong}).
 */
export function contractDisplayName(
  contract: ContractDisplayInput,
  client: ClientDisplayInput | null | undefined,
): string {
  const name = client?.trading_name ?? contract.client_id;
  const startLabel = formatIsoDateUkLong(contract.start_date);
  const endLabel =
    contract.end_date === null ? 'open-ended' : formatIsoDateUkLong(contract.end_date);
  return `${name} · ${startLabel}–${endLabel}`;
}
