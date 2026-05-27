/**
 * Resolve which contract to invoice from natural client name(s) — monthly supplier-issued only.
 */

import { allContracts } from '../contracts/index.js';
import { findClientById } from '../clients/index.js';

export interface MonthlyInvoiceContractCandidate {
  readonly contract_id: string;
  readonly label: string;
}

export type ResolveMonthlyInvoiceContractResult =
  | { readonly status: 'unique'; readonly contract_id: string }
  | {
      readonly status: 'ambiguous';
      readonly candidates: readonly MonthlyInvoiceContractCandidate[];
      readonly message: string;
    }
  | { readonly status: 'none'; readonly message: string };

function includesLoose(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase().trim());
}

/**
 * Supplier-issued + monthly cadence contracts only (`invoice_mechanism` / `invoice_cadence` on contract).
 */
export function resolveMonthlyInvoiceContract(params: {
  readonly contract_id?: string | undefined;
  readonly client_name?: string | undefined;
}): ResolveMonthlyInvoiceContractResult {
  const { contract_id: explicitId, client_name } = params;
  const monthlySupplier = allContracts().filter(
    c => c.invoice_mechanism === 'supplier-issued' && c.invoice_cadence === 'monthly',
  );

  if (explicitId !== undefined && explicitId.trim() !== '') {
    const c = monthlySupplier.find(x => x.id === explicitId.trim());
    if (c === undefined) {
      return {
        status: 'none',
        message:
          `No monthly supplier-issued contract with id "${explicitId.trim()}". Confirm contract_id or omit to search by client name.`,
      };
    }
    return { status: 'unique', contract_id: c.id };
  }

  if (client_name === undefined || client_name.trim() === '') {
    return {
      status: 'none',
      message: 'Provide contract_id or client_name to identify the invoice target.',
    };
  }

  const needle = client_name.trim();

  const matches: MonthlyInvoiceContractCandidate[] = [];
  for (const c of monthlySupplier) {
    const client = findClientById(c.client_id);
    if (client === null) continue;
    if (
      includesLoose(client.legal_name, needle)
      || includesLoose(client.trading_name, needle)
    ) {
      matches.push({
        contract_id: c.id,
        label: `${client.trading_name} (${c.id})`,
      });
    }
  }

  if (matches.length === 0) {
    return {
      status: 'none',
      message: `No monthly supplier-issued contract matches client_name "${needle}".`,
    };
  }
  if (matches.length === 1) {
    const only = matches[0];
    if (only === undefined) {
      return { status: 'none', message: 'Unexpected empty match list.' };
    }
    return { status: 'unique', contract_id: only.contract_id };
  }

  return {
    status: 'ambiguous',
    candidates: matches,
    message: 'Multiple contracts match; pass contract_id to disambiguate.',
  };
}
