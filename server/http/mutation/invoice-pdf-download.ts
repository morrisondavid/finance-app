/**
 * Canonical invoice PDF binary resolution (`GET /api/invoices/:id/pdf`) —
 * reused by Express + MCP (base64).
 */

import fs from 'fs';
import path from 'path';
import { findInvoiceById, renderInvoicePdf } from '../../domain/invoices/index.js';
import { findContractById } from '../../domain/contracts/index.js';
import { findClientById } from '../../domain/clients/index.js';
import { companyById } from '../../domain/company/index.js';
import { DEFAULT_INVOICES_DIR } from '../../domain/invoices/registry.js';

export type InvoicePdfDownloadMutationResult =
  | { readonly kind: 'pdf'; readonly filename: string; readonly buffer: Buffer }
  | { readonly kind: 'json'; readonly status: number; readonly body: Record<string, unknown> };

export async function mutateInvoicePdfDownload(invoiceId: string): Promise<InvoicePdfDownloadMutationResult> {
  const invoice = findInvoiceById(invoiceId);
  if (invoice === null) {
    return { kind: 'json', status: 404, body: { error: 'Invoice not found' } };
  }

  const projectRoot = path.dirname(DEFAULT_INVOICES_DIR);

  if (invoice.pdf_path !== null) {
    const absolutePath = path.resolve(projectRoot, invoice.pdf_path);
    if (fs.existsSync(absolutePath)) {
      const buffer = fs.readFileSync(absolutePath);
      return { kind: 'pdf', filename: `${invoice.id}.pdf`, buffer };
    }
  }

  const contract = findContractById(invoice.contract_id);
  const client = findClientById(invoice.client_id);
  const company = companyById(invoice.issuing_entity_id);
  if (contract === null || client === null || company === null) {
    return {
      kind: 'json',
      status: 404,
      body: {
        error:
          invoice.pdf_path === null
            ? 'Invoice has no PDF and linked entities are missing'
            : 'PDF file missing on disk and invoice cannot be re-rendered',
      },
    };
  }

  try {
    const buffer = await renderInvoicePdf(invoice, company, client);
    return { kind: 'pdf', filename: `${invoice.id}.pdf`, buffer };
  } catch (err) {
    return {
      kind: 'json',
      status: 500,
      body: {
        error: 'PDF render failed',
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
