/**
 * Reference extraction and index for invoice ↔ deposit reconciliation.
 *
 * Matches bank narratives to invoice `payment_reference` / `invoice_number`
 * using compacted, boundary-safe keys (exact equality — never substring
 * `includes` on index keys).
 */

import type { Invoice } from '../../../shared/api-contracts.js';
import { normaliseForMatch } from '../clients/narrative-match.js';

export function compactReference(raw: string): string {
  return normaliseForMatch(raw).replace(/\s+/g, '');
}

export function buildReferenceIndex(
  invoices: readonly Invoice[],
): ReadonlyMap<string, readonly Invoice[]> {
  const index = new Map<string, Invoice[]>();

  const add = (key: string, invoice: Invoice): void => {
    if (key.length === 0) return;
    const list = index.get(key) ?? [];
    if (!list.some(row => row.id === invoice.id)) {
      list.push(invoice);
    }
    index.set(key, list);
  };

  for (const invoice of invoices) {
    const paymentRef = compactReference(invoice.payment_reference);
    const invoiceNum = compactReference(invoice.invoice_number);
    add(paymentRef, invoice);
    if (invoiceNum !== paymentRef) {
      add(invoiceNum, invoice);
    }
  }

  return index;
}

/** Sorted compact keys from an index — used for prefix-ambiguity checks. */
export function referenceIndexKeys(
  index: ReadonlyMap<string, readonly Invoice[]>,
): readonly string[] {
  return [...index.keys()].sort((a, b) => a.localeCompare(b));
}

/**
 * Candidate compact keys extracted from a bank narrative (tokens, merged
 * pairs, and structured refs like SB-280052 / DC-001 / EG-0038).
 */
export function extractNarrativeReferenceKeys(description: string): readonly string[] {
  const keys = new Set<string>();
  const norm = normaliseForMatch(description);
  const tokens = norm.split(/\s+/).filter(token => token.length > 0);

  for (const token of tokens) {
    keys.add(token);
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    keys.add(`${tokens[i]}${tokens[i + 1]}`);
  }

  for (const match of description.matchAll(/SB\s*-?\s*(\d+)/gi)) {
    const digits = match[1];
    if (digits !== undefined && digits.length > 0) {
      keys.add(compactReference(`SB-${digits}`));
    }
  }

  // Emirates Islamic narratives concatenate `/INV/SB-298459SB-298461/` and may
  // wrap mid-reference (`SB-2984 64` → SB-298464). Scan a whitespace-free
  // compact form so line breaks do not drop cited SB numbers.
  const compactNarrative = normaliseForMatch(description).replace(/\s+/g, '');
  for (const match of compactNarrative.matchAll(/SB-?(\d+)/gi)) {
    const digits = match[1];
    if (digits !== undefined && digits.length > 0) {
      keys.add(compactReference(`SB-${digits}`));
    }
  }

  for (const match of description.matchAll(/\b([A-Z]{2,4})\s*-?\s*(\d+)\b/gi)) {
    const prefix = match[1];
    const digits = match[2];
    if (prefix !== undefined && digits !== undefined) {
      keys.add(compactReference(`${prefix}-${digits}`));
    }
  }

  return [...keys];
}

/**
 * Narrative tokens shorter than this never participate in prefix matching —
 * a stray `F` or `LTD` must not "cite" `FZ-0001` just because it happens to
 * be a unique prefix of one index key.
 */
const MIN_PREFIX_KEY_LENGTH = 5;

export type ReferenceLookupResult =
  | {
      readonly kind: 'hits';
      readonly invoices: readonly Invoice[];
      readonly matchedKeys: readonly string[];
    }
  | {
      readonly kind: 'ambiguous';
      readonly detail: string;
    }
  | { readonly kind: 'none' };

function collectInvoicesByIds(
  index: ReadonlyMap<string, readonly Invoice[]>,
  ids: ReadonlySet<string>,
): readonly Invoice[] {
  const out: Invoice[] = [];
  const seen = new Set<string>();
  for (const list of index.values()) {
    for (const invoice of list) {
      if (ids.has(invoice.id) && !seen.has(invoice.id)) {
        seen.add(invoice.id);
        out.push(invoice);
      }
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Resolve invoices cited in `description` via exact compact-key lookup.
 * A narrative token that is a strict prefix of multiple index keys is
 * treated as ambiguous (no auto-match).
 */
export function findReferencedInvoices(
  description: string,
  index: ReadonlyMap<string, readonly Invoice[]>,
  sortedIndexKeys: readonly string[],
): ReferenceLookupResult {
  const narrativeKeys = extractNarrativeReferenceKeys(description);
  const hitIds = new Set<string>();
  const matchedKeys: string[] = [];

  for (const nKey of narrativeKeys) {
    const direct = index.get(nKey);
    if (direct !== undefined && direct.length > 0) {
      for (const invoice of direct) {
        hitIds.add(invoice.id);
      }
      matchedKeys.push(nKey);
      continue;
    }

    if (nKey.length < MIN_PREFIX_KEY_LENGTH) {
      continue;
    }
    const prefixMatches = sortedIndexKeys.filter(
      key => key.startsWith(nKey) && key.length > nKey.length,
    );
    if (prefixMatches.length > 1) {
      // Truncated token (e.g. SB-28005) — skip; batch expansion may
      // resolve the remainder from amount-sum.
      continue;
    }
    if (prefixMatches.length === 1) {
      const key = prefixMatches[0]!;
      const invoices = index.get(key);
      if (invoices !== undefined) {
        for (const invoice of invoices) {
          hitIds.add(invoice.id);
        }
        matchedKeys.push(key);
      }
    }
  }

  if (hitIds.size === 0) {
    return { kind: 'none' };
  }

  return {
    kind: 'hits',
    invoices: collectInvoicesByIds(index, hitIds),
    matchedKeys,
  };
}
