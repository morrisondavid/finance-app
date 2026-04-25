/**
 * Shared CSV cell decoders + record reader.
 *
 * Every domain's `csv-io.ts` (`clients`, `contracts`, `invoices`,
 * `leave`, `company`, `master-agreements`, …) used to hand-roll the
 * same six string→primitive helpers and the same `csv-parse/sync`
 * reader options. By the time `invoice_payments.csv` was due to grow
 * in §1.3 Phase 4 we would have had a seventh copy — so the helpers
 * live here, and each domain `csv-io.ts` calls
 * {@link createCsvDecoders} once with its kind label.
 *
 * Why a factory rather than free functions: every error message
 * begins with the row's domain label (e.g. `Invoice DC-001:`,
 * `Contract dc-sow-2026:`) so a thrown decoder error tells you which
 * CSV file blew up without re-reading the stack. A factory keeps that
 * label closure-private and stops callers from drifting.
 *
 * Domain-specific decoders that no other domain shares (company's
 * `*OrTbc` family, contract's strict-boolean / non-negative-int) stay
 * in their respective files — extracting them here would invent shapes
 * with no second consumer.
 */

import fs from 'fs';
import { parse } from 'csv-parse/sync';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Domain-agnostic — used both by decoders below AND by row parsers as
 * the "skip empty rows" guard, so callers re-export it from their bag
 * for ergonomics.
 */
export function nullIfEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Bag of closures returned by {@link createCsvDecoders}. Every
 * function takes the cell value plus the column name and the row id;
 * thrown errors are prefixed with the kind label captured at
 * factory-construction time.
 */
export interface CsvDecoders {
  readonly nullIfEmpty: (value: string | undefined) => string | null;
  readonly requireNonEmpty: (
    value: string | undefined,
    field: string,
    rowId: string,
  ) => string;
  readonly decodeNumber: (
    value: string | undefined,
    field: string,
    rowId: string,
  ) => number;
  readonly decodeNullableNumber: (
    value: string | undefined,
    field: string,
    rowId: string,
  ) => number | null;
  readonly decodeIsoDate: (
    value: string | undefined,
    field: string,
    rowId: string,
  ) => string;
  readonly decodeNullableIsoDate: (
    value: string | undefined,
    field: string,
    rowId: string,
  ) => string | null;
  readonly decodeStrictBoolean: (
    value: string | undefined,
    field: string,
    rowId: string,
  ) => boolean;
  readonly decodeNonNegativeInt: (
    value: string | undefined,
    field: string,
    rowId: string,
  ) => number;
  readonly decodeNonNegativeNumber: (
    value: string | undefined,
    field: string,
    rowId: string,
  ) => number;
}

/**
 * Build a decoder bag prefixed with `kindLabel`. The label appears in
 * every thrown error so a `parseInvoiceRow` failure reads
 * `Invoice DC-001: total must be a number, got 'abc'`.
 */
export function createCsvDecoders(kindLabel: string): CsvDecoders {
  function requireNonEmpty(
    value: string | undefined,
    field: string,
    rowId: string,
  ): string {
    const v = nullIfEmpty(value);
    if (v === null) {
      throw new Error(`${kindLabel} ${rowId}: ${field} is required`);
    }
    return v;
  }

  function decodeNumber(
    value: string | undefined,
    field: string,
    rowId: string,
  ): number {
    const raw = requireNonEmpty(value, field, rowId);
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new Error(
        `${kindLabel} ${rowId}: ${field} must be a number, got '${raw}'`,
      );
    }
    return n;
  }

  function decodeNullableNumber(
    value: string | undefined,
    field: string,
    rowId: string,
  ): number | null {
    const raw = nullIfEmpty(value);
    if (raw === null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new Error(
        `${kindLabel} ${rowId}: ${field} must be a number, got '${raw}'`,
      );
    }
    return n;
  }

  function decodeIsoDate(
    value: string | undefined,
    field: string,
    rowId: string,
  ): string {
    const raw = requireNonEmpty(value, field, rowId);
    if (!ISO_DATE_REGEX.test(raw)) {
      throw new Error(
        `${kindLabel} ${rowId}: ${field} must be yyyy-mm-dd, got '${raw}'`,
      );
    }
    return raw;
  }

  function decodeNullableIsoDate(
    value: string | undefined,
    field: string,
    rowId: string,
  ): string | null {
    const raw = nullIfEmpty(value);
    if (raw === null) return null;
    if (!ISO_DATE_REGEX.test(raw)) {
      throw new Error(
        `${kindLabel} ${rowId}: ${field} must be yyyy-mm-dd, got '${raw}'`,
      );
    }
    return raw;
  }

  function decodeStrictBoolean(
    value: string | undefined,
    field: string,
    rowId: string,
  ): boolean {
    const raw = requireNonEmpty(value, field, rowId);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(
      `${kindLabel} ${rowId}: ${field} must be 'true' | 'false', got '${raw}'`,
    );
  }

  function decodeNonNegativeInt(
    value: string | undefined,
    field: string,
    rowId: string,
  ): number {
    const raw = requireNonEmpty(value, field, rowId);
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        `${kindLabel} ${rowId}: ${field} must be a non-negative integer, got '${raw}'`,
      );
    }
    return n;
  }

  function decodeNonNegativeNumber(
    value: string | undefined,
    field: string,
    rowId: string,
  ): number {
    const raw = requireNonEmpty(value, field, rowId);
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(
        `${kindLabel} ${rowId}: ${field} must be a non-negative number, got '${raw}'`,
      );
    }
    return n;
  }

  return {
    nullIfEmpty,
    requireNonEmpty,
    decodeNumber,
    decodeNullableNumber,
    decodeIsoDate,
    decodeNullableIsoDate,
    decodeStrictBoolean,
    decodeNonNegativeInt,
    decodeNonNegativeNumber,
  };
}

/**
 * Read a CSV file using the options every domain agreed on:
 *
 *   - `columns: true`              — first row is the header
 *   - `skip_empty_lines: true`     — blank lines are not rows
 *   - `trim: true`                 — cell whitespace is meaningless
 *   - `relax_column_count: true`   — short / long rows are tolerated;
 *                                     downstream parsers Zod-validate
 *                                     each cell, so a missing column
 *                                     surfaces as a precise per-field
 *                                     error rather than a parser crash.
 *
 * Missing or empty files return `[]` so callers don't need their own
 * existence guards.
 */
export function readCsvRecords(csvPath: string): Record<string, string>[] {
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf8').trim();
  if (content === '') return [];
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];
}
