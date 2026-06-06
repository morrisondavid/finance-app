/**
 * Persists a rendered invoice PDF under `<invoicesDir>/generated/`.
 *
 * The returned path is the canonical repo-relative location —
 * always relative to the project root so it survives a repo move,
 * and never contains backslashes.
 */

import fs from 'fs';
import path from 'path';
import type {
  Client,
  Company,
  Invoice,
} from '../../../../shared/api-contracts.js';
import { DEFAULT_INVOICES_DIR } from '../registry.js';
import { renderInvoicePdf } from './render.js';

export const GENERATED_PDF_SUBDIR = 'generated';

/** Directory under which outbound invoice PDFs live. */
export function getGeneratedPdfDir(invoicesDir: string = DEFAULT_INVOICES_DIR): string {
  return path.join(invoicesDir, GENERATED_PDF_SUBDIR);
}

/** Canonical disk path for a given invoice's generated PDF. */
export function getGeneratedPdfPath(
  invoice: Invoice,
  invoicesDir: string = DEFAULT_INVOICES_DIR,
): string {
  return path.join(getGeneratedPdfDir(invoicesDir), `${invoice.id}.pdf`);
}

/** Canonical repo-relative path — forward slashes. */
export function getRelativePdfPath(invoice: Invoice): string {
  return `invoices/${GENERATED_PDF_SUBDIR}/${invoice.id}.pdf`;
}

export interface WriteInvoicePdfInput {
  readonly invoice: Invoice;
  readonly company: Company;
  readonly client: Client;
  /** Override for tests. Defaults to {@link DEFAULT_INVOICES_DIR}. */
  readonly invoicesDir?: string;
}

export interface WriteInvoicePdfResult {
  /** Absolute path on disk. */
  readonly absolutePath: string;
  /** Repo-relative canonical path. */
  readonly relativePath: string;
  /** Byte size of the written PDF — useful for the route response. */
  readonly sizeBytes: number;
}

/**
 * Renders `invoice` and persists the PDF atomically (write-tmp →
 * rename). Idempotent: overwrites any existing file for the same
 * invoice id.
 */
export async function writeInvoicePdf(
  input: WriteInvoicePdfInput,
): Promise<WriteInvoicePdfResult> {
  const invoicesDir = input.invoicesDir ?? DEFAULT_INVOICES_DIR;
  const buffer = await renderInvoicePdf(input.invoice, input.company, input.client);

  const dir = getGeneratedPdfDir(invoicesDir);
  fs.mkdirSync(dir, { recursive: true });
  const absolutePath = getGeneratedPdfPath(input.invoice, invoicesDir);
  const tmp = `${absolutePath}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, absolutePath);

  return {
    absolutePath,
    relativePath: getRelativePdfPath(input.invoice),
    sizeBytes: buffer.length,
  };
}
