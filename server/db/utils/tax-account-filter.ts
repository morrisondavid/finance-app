import { getVatApplicableAccounts, getCorpTaxApplicableAccounts } from '../../types.js';

export interface AccountFilterResult {
  clause: string;
  params: string[];
}

/**
 * SQL fragment restricting rows to VAT-applicable accounts.
 * Returns `AND 1=0` (zero rows) when no accounts qualify — never silently falls back to "all".
 */
export function buildVatAccountFilter(): AccountFilterResult {
  const accounts = getVatApplicableAccounts();
  if (accounts.length === 0) return { clause: 'AND 1=0', params: [] };
  const placeholders = accounts.map(() => '?').join(',');
  return { clause: `AND account IN (${placeholders})`, params: [...accounts] };
}

/**
 * SQL fragment restricting rows to Corporation-Tax-applicable accounts.
 * Returns `AND 1=0` (zero rows) when no accounts qualify — never silently falls back to "all".
 */
export function buildCorpTaxAccountFilter(): AccountFilterResult {
  const accounts = getCorpTaxApplicableAccounts();
  if (accounts.length === 0) return { clause: 'AND 1=0', params: [] };
  const placeholders = accounts.map(() => '?').join(',');
  return { clause: `AND account IN (${placeholders})`, params: [...accounts] };
}
