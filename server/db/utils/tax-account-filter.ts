import type { AccountName } from '../../domain/accounts/index.js';

export interface AccountFilterResult {
  clause: string;
  params: string[];
}

/**
 * SQL fragment restricting rows to a specific set of account names.
 *
 * Returns `AND 1=0` (matches zero rows) when the set is empty — never
 * silently falls back to "all accounts". Callers get two callable
 * options:
 *   - VAT:   `buildAccountInFilter(vatApplicableAccounts())`
 *   - CorpTax: `buildAccountInFilter(corpTaxApplicableAccounts())`
 *
 * The single helper replaces the previous pair
 * `buildVatAccountFilter` / `buildCorpTaxAccountFilter`, which each
 * reached back into gate logic. Gates now live in the accounts
 * registry's indexes (`vatApplicable` / `corpTaxApplicable`); this
 * helper is purely the SQL-serialisation layer.
 */
export function buildAccountInFilter(accounts: readonly AccountName[]): AccountFilterResult {
  if (accounts.length === 0) return { clause: 'AND 1=0', params: [] };
  const placeholders = accounts.map(() => '?').join(',');
  return { clause: `AND account IN (${placeholders})`, params: [...accounts] };
}
