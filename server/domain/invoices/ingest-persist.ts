/**
 * Persists a self-bill after PDF text extraction — shared by the
 * `POST /api/invoices/ingest-self-bill` route and `POST /api/upload/invoices`
 * so the Upload tab and the Invoices modal hit the same pipeline.
 */

import type { Invoice } from '../../../shared/api-contracts.js';
import { createInvoice, updateInvoice } from './mutations.js';
import { findInvoiceById } from './queries.js';
import { ingestSelfBill } from './ingest-self-bill.js';
import { extractPdfText, type ParsedSelfBill } from './parsers/index.js';
import { writeIngestedPdf } from './pdf/ingested.js';

export type PersistIngestedSelfBillFromBufferResult =
  | {
      readonly ok: true;
      readonly invoice: Invoice;
      readonly parsed: ParsedSelfBill;
      readonly contractId: string;
      readonly clientId: string;
    }
  | { readonly ok: false; readonly code: string; readonly detail: unknown };

function rewindIngestRow(invoiceId: string): void {
  const existing = findInvoiceById(invoiceId);
  if (existing === null) return;
  if (existing.status === 'draft') return;
  updateInvoice({
    invoiceId,
    patch: { status: 'draft' },
  });
}

/**
 * Extract text → `ingestSelfBill` → create row → write PDF under
 * `invoices/ingested/`. Returns the final invoice row on success.
 */
export async function persistIngestedSelfBillFromBuffer(
  buffer: Buffer,
  today: string,
): Promise<PersistIngestedSelfBillFromBufferResult> {
  let rawText: string;
  try {
    rawText = await extractPdfText(buffer);
  } catch (err) {
    return {
      ok: false,
      code: 'pdf-text-failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const ingest = ingestSelfBill({ rawText, today });
  if (!ingest.ok) {
    return { ok: false, code: ingest.code, detail: ingest };
  }

  const createResult = createInvoice({ invoice: ingest.invoice });
  if (!createResult.ok) {
    if (createResult.code === 'duplicate-id') {
      return {
        ok: false,
        code: 'duplicate-id',
        detail: { invoiceId: createResult.invoiceId },
      };
    }
    return { ok: false, code: createResult.code, detail: createResult.issues };
  }

  try {
    writeIngestedPdf({
      invoice: createResult.invoice,
      buffer,
    });
  } catch (err) {
    rewindIngestRow(createResult.invoice.id);
    return {
      ok: false,
      code: 'write-pdf-failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    ok: true,
    invoice: createResult.invoice,
    parsed: ingest.parsed,
    contractId: ingest.contract.id,
    clientId: ingest.client.id,
  };
}
