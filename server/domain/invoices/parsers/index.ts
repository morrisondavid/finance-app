/**
 * Self-bill parser registry.
 *
 * A single record keyed by `ClientId` maps to a pure parser function.
 * `detectSelfBillKind(text)` scans the PDF text for each parser's
 * marker strings and returns the first match. The orchestrator uses
 * this to route raw text to the right parser without hard-coding a
 * chain of `if/else` branches.
 *
 * Adding a future supplier parser (e.g. a second agency) is:
 *   1. Add the `ClientId` → parser entry below.
 *   2. List its marker strings.
 *
 * That's it — no other file changes.
 */

import type { ClientId } from '../../../../shared/api-contracts.js';
import {
  parseLaFosseSelfBill,
  LA_FOSSE_TEXT_MARKERS,
  type ParseSelfBillResult,
} from './la-fosse.js';

export type SelfBillParserFn = (rawText: string) => ParseSelfBillResult;

export interface SelfBillParserEntry {
  readonly clientId: ClientId;
  /** Every marker must be present in the text for a positive detect. */
  readonly markers: readonly string[];
  readonly parse: SelfBillParserFn;
}

/** Registry of all self-bill parsers. Insertion order = detection order. */
export const SELF_BILL_PARSERS: readonly SelfBillParserEntry[] = [
  {
    clientId: 'la-fosse',
    markers: LA_FOSSE_TEXT_MARKERS,
    parse: parseLaFosseSelfBill,
  },
];

export type DetectSelfBillKindResult =
  | { readonly ok: true; readonly entry: SelfBillParserEntry }
  | { readonly ok: false; readonly code: 'no-parser-match' };

/**
 * Return the first parser whose marker strings all appear in the text.
 * Case-sensitive — the markers are copied verbatim from the supplier's
 * PDF template, and the parsers rely on the same casing downstream.
 */
export function detectSelfBillKind(
  rawText: string,
  parsers: readonly SelfBillParserEntry[] = SELF_BILL_PARSERS,
): DetectSelfBillKindResult {
  for (const entry of parsers) {
    if (entry.markers.every(marker => rawText.includes(marker))) {
      return { ok: true, entry };
    }
  }
  return { ok: false, code: 'no-parser-match' };
}

export { parseLaFosseSelfBill, LA_FOSSE_TEXT_MARKERS } from './la-fosse.js';
export type {
  ParseSelfBillResult,
  ParsedSelfBill,
} from './la-fosse.js';
export { extractPdfText } from './pdf-text.js';
