/**
 * Human-facing engagement labels — one place for client + date range text.
 * `Contract.reference` in CSV should normally match this or be a shorter custom title.
 */

import { formatIsoDateUkLong } from './formatting.js';

export interface ContractDateInput {
  readonly start_date: string;
  readonly end_date: string;
}

export interface ContractDisplayInput extends ContractDateInput {
  readonly client_id: string;
}

export interface ClientDisplayInput {
  readonly trading_name: string;
}

/** `start_date <= today <= end_date`. */
export function isContractCurrent(contract: ContractDateInput, today: string): boolean {
  return contract.start_date <= today && today <= contract.end_date;
}

/** `today > end_date`. */
export function isContractExpired(contract: ContractDateInput, today: string): boolean {
  return today > contract.end_date;
}

/** `today < start_date`. */
export function isContractUpcoming(contract: ContractDateInput, today: string): boolean {
  return today < contract.start_date;
}

/**
 * Canonical display line: `{trading_name} · {start}–{end}` with
 * dates as `DD Mmm YYYY` (abbreviated month, UK-oriented via {@link formatIsoDateUkLong}).
 */
export function contractDisplayName(
  contract: ContractDisplayInput,
  client: ClientDisplayInput | null | undefined,
): string {
  const name = client?.trading_name ?? contract.client_id;
  const startLabel = formatIsoDateUkLong(contract.start_date);
  const endLabel = formatIsoDateUkLong(contract.end_date);
  return `${name} · ${startLabel}–${endLabel}`;
}
