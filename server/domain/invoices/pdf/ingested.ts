/**
 * Persists an *ingested* self-bill PDF under `<invoicesDir>/ingested/`.
 *
 * Parallel to {@link writeInvoicePdf} in `write.ts`, but the source is
 * a raw buffer that the route layer already has in hand (from multer)
 * rather than something rendered via pdfmake. The shape of the return
 * value and the disk layout match 1:1 so the rest of the app can treat
 * outbound and self-billed PDFs identically.
 */

import fs from 'fs';
import path from 'path';
import type { Invoice } from '../../../../shared/api-contracts.js';
import { DEFAULT_INVOICES_DIR } from '../registry.js';

export const INGESTED_PDF_SUBDIR = 'ingested';

/** Directory under which ingested self-bill PDFs live. */
export function getIngestedPdfDir(
  invoicesDir: string = DEFAULT_INVOICES_DIR,
): string {
  return path.join(invoicesDir, INGESTED_PDF_SUBDIR);
}

/** Canonical disk path for a given invoice's ingested PDF. */
export function getIngestedPdfPath(
  invoice: Invoice,
  invoicesDir: string = DEFAULT_INVOICES_DIR,
): string {
  return path.join(getIngestedPdfDir(invoicesDir), `${invoice.id}.pdf`);
}

/** Canonical repo-relative path — forward slashes. */
export function getRelativeIngestedPdfPath(invoice: Invoice): string {
  return `invoices/${INGESTED_PDF_SUBDIR}/${invoice.id}.pdf`;
}

export interface WriteIngestedPdfInput {
  readonly invoice: Invoice;
  readonly buffer: Buffer;
  /** Override for tests. Defaults to {@link DEFAULT_INVOICES_DIR}. */
  readonly invoicesDir?: string;
}

export interface WriteIngestedPdfResult {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly sizeBytes: number;
}

/**
 * Persists `buffer` as the canonical ingested PDF for `invoice`.
 * Atomic (write-tmp → rename) and idempotent.
 */
export function writeIngestedPdf(
  input: WriteIngestedPdfInput,
): WriteIngestedPdfResult {
  const invoicesDir = input.invoicesDir ?? DEFAULT_INVOICES_DIR;
  const dir = getIngestedPdfDir(invoicesDir);
  fs.mkdirSync(dir, { recursive: true });

  const absolutePath = getIngestedPdfPath(input.invoice, invoicesDir);
  const tmp = `${absolutePath}.tmp`;
  fs.writeFileSync(tmp, input.buffer);
  fs.renameSync(tmp, absolutePath);

  return {
    absolutePath,
    relativePath: getRelativeIngestedPdfPath(input.invoice),
    sizeBytes: input.buffer.length,
  };
}
