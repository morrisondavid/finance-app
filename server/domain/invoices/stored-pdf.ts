/**
 * Whether an invoice has an archived PDF on disk (accountant pack + PDF button).
 *
 * Canonical layout (by mechanism + id):
 *   supplier-issued → invoices/generated/{id}.pdf
 *   self-bill       → invoices/ingested/{id}.pdf
 */

import fs from 'fs';
import path from 'path';
import type { Invoice } from '../../../shared/api-contracts.js';
import { REPO_ROOT } from '../statements/statement-files-catalog.js';
import { getRelativeIngestedPdfPath } from './pdf/ingested.js';
import { getRelativePdfPath } from './pdf/write.js';

function canonicalRelativePdfPath(invoice: Invoice): string {
  return invoice.mechanism === 'supplier-issued'
    ? getRelativePdfPath(invoice)
    : getRelativeIngestedPdfPath(invoice);
}

/** Absolute path to the canonical archived PDF, or null when the file is missing. */
export function invoiceStoredPdfAbsolutePath(invoice: Invoice): string | null {
  const absolute = path.resolve(REPO_ROOT, canonicalRelativePdfPath(invoice));
  return fs.existsSync(absolute) ? absolute : null;
}

export function isInvoiceStoredPdfAvailable(invoice: Invoice): boolean {
  return invoiceStoredPdfAbsolutePath(invoice) !== null;
}
