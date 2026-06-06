/**
 * Canonical invoice PDF binary resolution (`GET /api/invoices/:id/pdf`) —
 * reused by Express + MCP (base64).
 */

import fs from 'fs';
import { findInvoiceById } from '../../domain/invoices/index.js';
import { invoiceStoredPdfAbsolutePath } from '../../domain/invoices/stored-pdf.js';

export type InvoicePdfDownloadMutationResult =
  | { readonly kind: 'pdf'; readonly filename: string; readonly buffer: Buffer }
  | { readonly kind: 'json'; readonly status: number; readonly body: Record<string, unknown> };

export async function mutateInvoicePdfDownload(invoiceId: string): Promise<InvoicePdfDownloadMutationResult> {
  const invoice = findInvoiceById(invoiceId);
  if (invoice === null) {
    return { kind: 'json', status: 404, body: { error: 'Invoice not found' } };
  }

  const absolutePath = invoiceStoredPdfAbsolutePath(invoice);
  if (absolutePath === null || !fs.existsSync(absolutePath)) {
    return {
      kind: 'json',
      status: 404,
      body: {
        error: 'stored-pdf-missing',
        message:
          'No archived PDF on disk for this invoice. Use Generate (supplier-issued) or Ingest (self-bill) first.',
      },
    };
  }

  const buffer = fs.readFileSync(absolutePath);
  return { kind: 'pdf', filename: `${invoice.id}.pdf`, buffer };
}
