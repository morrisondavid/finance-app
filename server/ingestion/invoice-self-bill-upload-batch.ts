/**
 * Self-bill invoice PDF ingestion batch — same saga as `POST /api/upload/invoices`
 * and `POST /api/invoices/ingest-self-bill`, but wired from decoded buffers / disk reads.
 */

import type { UploadedFile } from '../types.js';
import type { InvoiceUploadIngestResult, UploadResponse } from '../types.js';
import { persistIngestedSelfBillFromBuffer } from '../domain/invoices/index.js';

export interface SelfBillBufferInput {
  readonly filename: string;
  readonly buffer: Buffer;
}

export type InvoiceSelfBillBatchResult = { readonly status: number; readonly body: UploadResponse };

/**
 * Mirrors the server route: always `{ status:200, body}` with aggregate message + outcomes.
 * Caller supplies `today` ISO date (reuse `todayIsoLocal()` from shared).
 */
export async function executeSelfBillPdfBuffers(
  inputs: readonly SelfBillBufferInput[],
  today: string,
): Promise<InvoiceSelfBillBatchResult> {
  if (inputs.length === 0) {
    return {
      status: 400,
      body: {
        message: 'No invoice PDF inputs',
        files: [],
      },
    };
  }

  const ingestOutcomes: InvoiceUploadIngestResult[] = [];
  let ingestedCount = 0;

  for (const item of inputs) {
    const persisted = await persistIngestedSelfBillFromBuffer(item.buffer, today);
    if (persisted.ok) {
      ingestedCount += 1;
      ingestOutcomes.push({
        filename: item.filename,
        outcome: 'ingested',
        invoiceId: persisted.invoice.id,
      });
      continue;
    }

    if (
      persisted.code === 'no-parser-match' ||
      persisted.code === 'parse-failed' ||
      persisted.code === 'unexpected-format' ||
      persisted.code === 'no-contract-match'
    ) {
      ingestOutcomes.push({
        filename: item.filename,
        outcome: 'archived-only',
        code: persisted.code,
        message: 'File kept in invoices/ — not a recognised self-bill layout',
      });
      continue;
    }

    ingestOutcomes.push({
      filename: item.filename,
      outcome: 'failed',
      code: persisted.code,
      message: typeof persisted.detail === 'string' ? persisted.detail : persisted.code,
    });
  }

  const syntheticRows: UploadedFile[] = inputs.map((row, idx) => ({
    filename: row.filename,
    size: row.buffer.length,
    path: `#buffer-${String(idx)}`,
  }));

  const parts: string[] = [
    `Received ${String(inputs.length)} invoice PDF(s)`,
    ingestedCount > 0 ? `${String(ingestedCount)} ingested as self-bill` : null,
    ingestedCount < inputs.length ? 'others archived or failed (see details)' : null,
  ].filter((p): p is string => p !== null);

  return {
    status: 200,
    body: {
      message: parts.join(' · '),
      files: syntheticRows,
      invoiceIngestResults: ingestOutcomes,
    },
  };
}
