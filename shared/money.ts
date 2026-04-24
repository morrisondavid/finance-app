/**
 * Money parsing primitives — one entry point for converting human-
 * formatted monetary strings into numeric pence/whole-pound values.
 *
 * Consumers (present & future):
 *   - `server/domain/invoices/parsers/la-fosse.ts`
 *       Self-bill PDF parser pulls `Net`, `VAT`, and `Gross` values
 *       straight off the extracted text and needs a single tolerant
 *       parser that handles the currency symbol, thousands separators,
 *       and an optional fractional part.
 *   - Phase 4 reconciler (planned) — will reuse this to correlate
 *       bank-narrative amounts with invoice totals.
 *   - Future OCR parsers — same story.
 *
 * Deliberately strict on "definitely not a number" (returns null) so
 * parsers upstream can emit structured `amount-unparseable` errors
 * instead of silently rounding garbage to zero.
 */

/**
 * Parse a money-ish string such as `"2,500.00"`, `"£2,500.00"`,
 * `"GBP 2500"`, or `"2500"` into a plain number. Returns `null` when
 * the input contains no numeric content, contains more than one
 * decimal point, or is otherwise unparseable.
 *
 * Keeps negatives (`"-500"`, `"(500)"` → `-500`) because self-bill
 * adjustments occasionally appear as credit rows.
 */
export function parseMoneyAmount(s: string): number | null {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (trimmed.length === 0) return null;

  // Accountants sometimes wrap negatives in parens: "(500.00)".
  const parensNegative = /^\((.+)\)$/.exec(trimmed);
  const body = parensNegative !== null ? parensNegative[1] : trimmed;

  // Detect a leading minus sign AFTER we've stripped parens so both
  // conventions fold into the same sign flag.
  const explicitNegative = /^[+-]?\s*[£€$]?\s*-/.test(body) || /^-/.test(body);
  const negative = parensNegative !== null || explicitNegative;

  // Keep digits, decimal point, and nothing else. Thousands separators
  // (`,`) and currency symbols (`£`, `€`, `$`, ISO codes, spaces) are
  // all dropped.
  const digits = body.replace(/[^\d.]/g, '');
  if (digits.length === 0) return null;

  // Reject multi-dot strings like "1.234.56" — the parser would
  // otherwise silently turn them into NaN via parseFloat, and a silent
  // NaN is exactly the failure mode this helper exists to avoid.
  const dotCount = digits.split('.').length - 1;
  if (dotCount > 1) return null;

  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}
