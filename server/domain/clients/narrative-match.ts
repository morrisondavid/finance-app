/**
 * Narrative matching — how do I recognise "this client" on a bank
 * statement?
 *
 * Three pure helpers shared by every feature that needs to correlate
 * a free-text bank-statement narrative with a row in `clients.csv`:
 *
 *   - `normaliseForMatch(raw)`
 *         lower-level primitive; uppercase, strip diacritics, drop
 *         anything not alphanumeric, collapse whitespace.
 *   - `buildNarrativeTokens(client)`
 *         trading / first-word / legal-name token set, pre-normalised.
 *   - `narrativeMatches(description, tokens)`
 *         cheap substring check against the pre-normalised tokens.
 *
 * Consumers:
 *   - `server/domain/contracts/last-payment.ts` — `findLastInvoicePaymentDate`
 *     uses these to find when a contract's last invoice payment landed.
 *   - `server/domain/contracts/payer-match.ts` — `matchPayerToContract`
 *     (1.2.C) uses the same primitives to flag "payment from known
 *     payer outside any active contract window" warnings.
 *
 * Keeping the helpers here (in the clients domain) rather than in the
 * contracts domain makes the ownership obvious: "how do I recognise a
 * client" is a property of the client row, not of any contract. Every
 * future matcher (self-bill parser, reconciler, reminders, …) should
 * import from this module and not reinvent the normalisation.
 */

import type { Client } from '../../../shared/api-contracts.js';

/**
 * Normalise a string for substring matching: uppercase, strip
 * diacritics, drop anything that isn't A-Z / 0-9 / space, and collapse
 * runs of whitespace. `"La Fosse Associates Ltd."` becomes
 * `"LA FOSSE ASSOCIATES LTD"` which matches statements that render it
 * as `"LAFOSSE ASSOCIATES"` or `"La Fosse  Associates Ltd"` equally
 * well — the substring check uses the normalised token below.
 */
export function normaliseForMatch(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build the token set used for narrative matching. Includes the
 * client's trading name (usually short and distinctive — `"LA FOSSE"`,
 * `"DELTA CAPITA"`), the first word of the trading name as a looser
 * fallback (helps when the statement abbreviates to `"LAFOSSE"` or
 * `"DELTA"`), and the legal name when it differs. All tokens are
 * pre-normalised so `narrativeMatches` can do a cheap includes-check.
 */
export function buildNarrativeTokens(client: Client): readonly string[] {
  const tokens = new Set<string>();
  const trading = normaliseForMatch(client.trading_name);
  if (trading.length > 0) tokens.add(trading);
  const firstTradingWord = trading.split(' ')[0];
  if (firstTradingWord !== undefined && firstTradingWord.length >= 4) {
    tokens.add(firstTradingWord);
  }
  const legal = normaliseForMatch(client.legal_name);
  if (legal.length > 0 && legal !== trading) tokens.add(legal);
  return Array.from(tokens);
}

/**
 * Return `true` iff at least one token appears as a substring of the
 * (normalised) description. Tokens are assumed pre-normalised from
 * `buildNarrativeTokens` — we only normalise the haystack.
 */
export function narrativeMatches(
  description: string,
  tokens: readonly string[],
): boolean {
  if (tokens.length === 0) return false;
  const haystack = normaliseForMatch(description);
  if (haystack.length === 0) return false;
  for (const token of tokens) {
    if (haystack.includes(token)) return true;
  }
  return false;
}
