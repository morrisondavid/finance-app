/**
 * La Fosse self-bill parser — pure.
 *
 * Takes the text extracted by `extractPdfText` (already peeled off the
 * PDF wrapper by `pdf-text.ts`) and turns it into a
 * `ParseSelfBillResult` discriminated union. It never touches the
 * registry, the file system, or the clock, which keeps the parser
 * unit-testable against committed text fixtures + the known-good PDF.
 *
 * The orchestrator (`ingest-self-bill.ts`) is responsible for:
 *   - contract lookup (via `placement_ref` vs `contract.reference`);
 *   - duplicate detection (via `payment_reference`);
 *   - canonical id assignment (via `nextInvoiceIdForEntity`).
 *
 * All the parser does is translate the PDF's human-shaped text into
 * the machine-shaped `ParsedSelfBill` that the orchestrator consumes.
 */

import { parseIsoFromDDMMYYYY } from '../../../../shared/iso-date.js';
import { parseMoneyAmount } from '../../../../shared/money.js';

/** Everything the orchestrator needs to compose the canonical invoice. */
export interface ParsedSelfBill {
  /** La Fosse's own invoice id, preserved verbatim (e.g. `SB-277615`). */
  readonly supplierInvoiceNumber: string;
  /** ISO date — La Fosse's `Date: dd/mm/yyyy` line. */
  readonly invoiceDate: string;
  /** ISO date — La Fosse's `Period Ending: dd/mm/yyyy` line. */
  readonly periodEnd: string;
  /** ISO date — earliest worked-day row in the breakdown table. */
  readonly periodStart: string;
  /** Contract lookup key — La Fosse's `Placement Ref:` line (e.g. `BH-28240`). */
  readonly placementRef: string;
  /** Worker name (defensive — we only accept self-bills for David). */
  readonly workerName: string;
  /** Job title as printed on the sheet row. */
  readonly jobTitle: string;
  /** Billable units (normally one per worked day). */
  readonly daysBilled: number;
  /** Invoice currency (normally GBP). */
  readonly currency: string;
  /** Money values in `currency`. */
  readonly subtotal: number;
  readonly vatAmount: number;
  readonly total: number;
  /** VAT rate as a decimal (0.2 for `S-GB 20.00%`). */
  readonly vatRate: number;
}

export type ParseSelfBillResult =
  | { readonly ok: true; readonly invoice: ParsedSelfBill }
  | { readonly ok: false; readonly code: 'unexpected-format'; readonly detail: string }
  | { readonly ok: false; readonly code: 'empty-text' };

/** First line with a La Fosse vendor marker we can key the detector on. */
export const LA_FOSSE_TEXT_MARKERS: readonly string[] = [
  'La Fosse Associates Ltd',
  'SELF BILLING INVOICE',
];

/** Try every supplied regex, return the first capture group or `null`. */
function firstMatch(text: string, patterns: readonly RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m !== null && m[1] !== undefined) return m[1].trim();
  }
  return null;
}

/**
 * Parse a La Fosse self-bill. Input is the already-extracted PDF text;
 * output is a discriminated union so callers branch without try/catch.
 */
export function parseLaFosseSelfBill(rawText: string): ParseSelfBillResult {
  if (rawText.trim() === '') {
    return { ok: false, code: 'empty-text' };
  }

  const text = rawText;

  const supplierInvoiceNumber = firstMatch(text, [
    /Invoice Number:\s*(\S+)/,
  ]);
  if (supplierInvoiceNumber === null) {
    return failWithMissing('Invoice Number');
  }

  const invoiceDateRaw = firstMatch(text, [
    /^Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/m,
  ]);
  if (invoiceDateRaw === null) return failWithMissing('Date');
  const invoiceDate = parseIsoFromDDMMYYYY(invoiceDateRaw);
  if (invoiceDate === null) {
    return failInvalid('Date', invoiceDateRaw);
  }

  const periodEndRaw = firstMatch(text, [
    /Period Ending:\s*(\d{1,2}\/\d{1,2}\/\d{4})/,
  ]);
  if (periodEndRaw === null) return failWithMissing('Period Ending');
  const periodEnd = parseIsoFromDDMMYYYY(periodEndRaw);
  if (periodEnd === null) return failInvalid('Period Ending', periodEndRaw);

  const placementRef = firstMatch(text, [
    /Placement Ref:\s*(\S+)/,
  ]);
  if (placementRef === null) return failWithMissing('Placement Ref');

  const workerName = firstMatch(text, [
    /Worker:\s*([A-Za-z][A-Za-z .'-]+?)(?:\s{2,}|\s*(?:PO:|Client Site:|$))/m,
  ]);
  if (workerName === null) return failWithMissing('Worker');

  const currency = firstMatch(text, [
    /Currency:\s*([A-Z]{3})/,
  ]);
  if (currency === null) return failWithMissing('Currency');

  // Totals block:
  //   Net 1,000.00
  //   VAT 200.00
  //   Gross GBP 1,200.00
  const subtotalRaw = firstMatch(text, [
    /^Net\s+([\d,]+(?:\.\d{2})?)$/m,
  ]);
  const vatAmountRaw = firstMatch(text, [
    /^VAT\s+([\d,]+(?:\.\d{2})?)$/m,
  ]);
  const totalRaw = firstMatch(text, [
    /^Gross\s+[A-Z]{3}\s+([\d,]+(?:\.\d{2})?)$/m,
  ]);
  if (subtotalRaw === null) return failWithMissing('Net');
  if (vatAmountRaw === null) return failWithMissing('VAT');
  if (totalRaw === null) return failWithMissing('Gross');

  const subtotal = parseMoneyAmount(subtotalRaw);
  const vatAmount = parseMoneyAmount(vatAmountRaw);
  const total = parseMoneyAmount(totalRaw);
  if (subtotal === null) return failInvalid('Net', subtotalRaw);
  if (vatAmount === null) return failInvalid('VAT', vatAmountRaw);
  if (total === null) return failInvalid('Gross', totalRaw);

  // `Rate S-GB 20.00%` → 0.20. Zero-VAT invoices still print the row
  // with a `0.00%` rate — we round-trip whatever the supplier declared.
  const vatRateRaw = firstMatch(text, [
    /Rate\s+S-\w+\s+(\d+(?:\.\d+)?)%/,
  ]);
  const vatRate = vatRateRaw === null ? 0 : Number(vatRateRaw) / 100;
  if (Number.isNaN(vatRate)) return failInvalid('VAT rate', vatRateRaw ?? '');

  // Sheet row: `… 2.00 units Day Rate 500.00 1,000.00`. The `units`
  // token is the billable count we want.
  const daysBilledRaw = firstMatch(text, [
    /(\d+(?:\.\d+)?)\s*units\s+Day Rate/,
  ]);
  if (daysBilledRaw === null) return failWithMissing('units');
  const daysBilled = Number(daysBilledRaw);
  if (Number.isNaN(daysBilled)) return failInvalid('units', daysBilledRaw);

  const jobTitle = firstMatch(text, [
    /Job Title\s*\/\s*Sector:\s*([^\n]+?)(?:\s*Worker:|$)/m,
  ]);
  if (jobTitle === null) return failWithMissing('Job Title / Sector');

  const periodStart = resolvePeriodStart(text);
  if (periodStart === null) {
    return failInvalid('period start (earliest day rate row)', '');
  }

  return {
    ok: true,
    invoice: {
      supplierInvoiceNumber,
      invoiceDate,
      periodEnd,
      periodStart,
      placementRef,
      workerName,
      jobTitle,
      daysBilled,
      currency,
      subtotal,
      vatAmount,
      total,
      vatRate,
    },
  };
}

/**
 * Scan the day-rate breakdown at the foot of the sheet and return the
 * earliest date. Format of each row (post pdf-parse):
 *
 *   `30/10/2025 Day Rate 1.00`
 */
function resolvePeriodStart(text: string): string | null {
  const re = /^(\d{1,2}\/\d{1,2}\/\d{4})\s+Day Rate/gm;
  let earliest: string | null = null;
  for (const match of text.matchAll(re)) {
    const iso = parseIsoFromDDMMYYYY(match[1]!);
    if (iso === null) continue;
    if (earliest === null || iso < earliest) {
      earliest = iso;
    }
  }
  return earliest;
}

function failWithMissing(field: string): ParseSelfBillResult {
  return {
    ok: false,
    code: 'unexpected-format',
    detail: `Missing expected field: ${field}`,
  };
}

function failInvalid(field: string, raw: string): ParseSelfBillResult {
  return {
    ok: false,
    code: 'unexpected-format',
    detail: `Invalid ${field} value: ${JSON.stringify(raw)}`,
  };
}
