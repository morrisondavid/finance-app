/**
 * Build SQLite description predicates for `merchantModalLabel` filtering.
 * Parity target: {@link expenseTxnMatchesMerchantModal} (same UX as merchant drill modal).
 */

import {
  merchantDrillSearchSql,
  type MerchantDrillSearchSql,
} from './merchant-drill-search.js';
import { getMerchantsRegistry } from '../domain/merchants/registry.js';

/**
 * Matches {@link matchesUberEats} semantics — "uber" then later "eats" in description.
 * Passed to SQLite `regexp()` — connection registers case-insensitive JS RegExp evaluation.
 */
const UBER_EATS_ORDERING_PATTERN = 'uber.{0,200}eats';

/** SQL fragment + bind params (`?`) for merchant modal drill. Returns null ⇒ use JS fallback. */
export function buildMerchantModalDescriptionPredicate(
  labelRaw: string,
): { clause: string; params: string[] } | null {
  const label = labelRaw.trim();
  if (label.length === 0) return null;

  const lower = label.toLowerCase();
  if (lower === 'uber eats') {
    return { clause: 'regexp(?, description) = 1', params: [UBER_EATS_ORDERING_PATTERN] };
  }

  const drill = merchantDrillSearchSql(label);
  if (drill !== null) {
    return merchantDrillToClause(drill);
  }

  const patterns = getMerchantsRegistry().indexes.patterns.filter(
    e => e.displayName !== null && e.displayName === label,
  );
  if (patterns.length === 0) return null;

  const clause = patterns.map(() => 'regexp(?, description) = 1').join(' OR ');
  const params = patterns.map(e => e.pattern.source);
  return { clause, params };
}

function merchantDrillToClause(drill: MerchantDrillSearchSql): { clause: string; params: string[] } {
  if (drill.kind === 'like_lower') {
    return {
      clause: "LOWER(description) LIKE ? ESCAPE '\\'",
      params: [drill.pattern],
    };
  }
  const extra = drill.extraSql ?? '';
  return { clause: `regexp(?, description) = 1${extra}`, params: [drill.pattern] };
}
