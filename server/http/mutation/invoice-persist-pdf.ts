/**
 * Persist a rendered PDF for an existing supplier-issued invoice row.
 */

import {
  findInvoiceById,
  writeInvoicePdf,
} from '../../domain/invoices/index.js';
import { isInvoiceStoredPdfAvailable } from '../../domain/invoices/stored-pdf.js';
import { findContractById } from '../../domain/contracts/index.js';
import { findClientById } from '../../domain/clients/index.js';
import { companyById } from '../../domain/company/index.js';
import { publishGeneratedInvoiceArtifacts } from '../../ingestion/invoice-upload-durable-publish.js';
import type { JsonMutationResult } from './types.js';

export async function mutateInvoicePersistPdf(invoiceId: string): Promise<JsonMutationResult> {
  const invoice = findInvoiceById(invoiceId);
  if (invoice === null) {
    return { status: 404, body: { error: 'Invoice not found' } };
  }

  if (isInvoiceStoredPdfAvailable(invoice)) {
    return { status: 200, body: { invoice } };
  }

  if (invoice.mechanism !== 'supplier-issued') {
    return {
      status: 400,
      body: {
        error: 'not-supplier-issued',
        message: 'Only supplier-issued invoices can be generated here. Use ingest for self-bills.',
      },
    };
  }

  const contract = findContractById(invoice.contract_id);
  const client = findClientById(invoice.client_id);
  const company = companyById(invoice.issuing_entity_id);
  if (contract === null || client === null || company === null) {
    return { status: 400, body: { error: 'Invoice references unknown entities' } };
  }

  try {
    await writeInvoicePdf({ invoice, company, client });
    const refreshed = findInvoiceById(invoice.id);
    if (refreshed === null) {
      return { status: 500, body: { error: 'Invoice disappeared after PDF write' } };
    }

    await publishGeneratedInvoiceArtifacts(refreshed);

    return { status: 200, body: { invoice: refreshed } };
  } catch (err) {
    return {
      status: 500,
      body: {
        error: 'PDF render failed',
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
