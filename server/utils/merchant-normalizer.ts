/**
 * Merchant name normalizer -- converts raw transaction descriptions into
 * clean, human-readable merchant display names.
 *
 * Consumes the merchants domain registry so display names and
 * category assignments cannot drift out of sync. Entries with
 * `displayName: null` are skipped (category-only matchers); if no
 * named entry matches, a generic cleanup fallback is applied.
 */

import { findFirstNamedMatch } from '../domain/merchants/index.js';

// ─── Fallback cleanup ────────────────────────────────────────────────────────

const NOISE_PATTERNS = [
  /\s{2,}/g,
  /\b\d{4,}\b/g,
  /\bREF[:\s]?\S+/gi,
  /\b(GBR|GBP|USD|EUR|AED)\b/gi,
  /\b(DIRECT DEBIT|FASTER PAYMENT|STANDING ORDER|CARD PAYMENT)\b/gi,
  /\b(DD|STO|FP|CR|DR|BGC)\b/g,
  /[,\/\\]+/g,
];

function cleanFallback(description: string): string {
  let cleaned = description;
  for (const pat of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pat, ' ');
  }
  // Remove orphaned fractional tails left when 4+ digit amounts were stripped (e.g. "… Of .00").
  cleaned = cleaned.replace(/\s+\.\d{1,3}\b/g, ' ');
  cleaned = cleaned.trim().replace(/\s+/g, ' ');

  if (cleaned.length === 0) return description.trim();

  const segments = cleaned.split(/\s{2,}/);
  const core = segments[0] ?? cleaned;

  return toTitleCase(core.slice(0, 40));
}

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, c => c.toUpperCase())
    .trim();
}

// ─── Public API ──────────────────────────────────────────────────────────────

function normalizeForMatching(raw: string): string {
  return raw
    .replace(/[,\/\\]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function normalizeMerchant(description: string): string {
  const normalized = normalizeForMatching(description);
  const named = findFirstNamedMatch(normalized);
  if (named !== null) return named;
  return cleanFallback(description);
}
