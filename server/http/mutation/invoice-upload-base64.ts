/**
 * MCP entry for self-bill invoice uploads (`POST /api/upload/invoices`) via base64 payloads.
 */

import path from 'path';
import type { JsonMutationResult } from './types.js';
import { MCP_STATEMENT_UPLOAD_MAX_BYTES_PER_FILE } from './statements-upload-base64.js';
import { evaluateUploadAcceptance } from '../../ingestion/upload-evaluate-acceptance.js';
import { executeSelfBillPdfBuffers } from '../../ingestion/invoice-self-bill-upload-batch.js';

export const MCP_INVOICE_PDF_UPLOAD_MAX_FILES = 5;

function decodePdfBase64(raw: string): Buffer | JsonMutationResult {
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    return { status: 400, body: { error: 'Invalid base64 payload' } };
  }
  if (buf.byteLength === 0) {
    return { status: 400, body: { error: 'Empty file after base64 decode' } };
  }
  if (buf.byteLength > MCP_STATEMENT_UPLOAD_MAX_BYTES_PER_FILE) {
    return {
      status: 413,
      body: { error: 'PDF too large after decode', maxBytesPerFile: MCP_STATEMENT_UPLOAD_MAX_BYTES_PER_FILE },
    };
  }
  return buf;
}

export async function mutateInvoicePdfsUploadFromBase64(payload: unknown, today: string): Promise<JsonMutationResult> {
  const parsed = parseInvoiceEnvelope(payload);
  if ('error' in parsed) return parsed.error;

  return executeSelfBillPdfBuffers(parsed.files, today);
}

function parseInvoiceEnvelope(payload: unknown):
  | { error: JsonMutationResult }
  | { files: readonly { readonly filename: string; readonly buffer: Buffer }[] } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { error: { status: 400, body: { error: 'Invalid body' } } };
  }
  const root = payload as Record<string, unknown>;
  const filesRaw = root.files;

  if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
    return { error: { status: 400, body: { error: 'No files uploaded' } } };
  }
  if (filesRaw.length > MCP_INVOICE_PDF_UPLOAD_MAX_FILES) {
    return {
      error: {
        status: 400,
        body: {
          error: 'Too many invoice PDF files for MCP',
          maxFiles: MCP_INVOICE_PDF_UPLOAD_MAX_FILES,
        },
      },
    };
  }

  const out: { filename: string; buffer: Buffer }[] = [];

  let totalDecoded = 0;

  const maxTotalDecoded =
    MCP_STATEMENT_UPLOAD_MAX_BYTES_PER_FILE * MCP_INVOICE_PDF_UPLOAD_MAX_FILES;

  for (const entry of filesRaw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { error: { status: 400, body: { error: 'Each file entry must be an object' } } };
    }
    const e = entry as Record<string, unknown>;
    const filename = e.filename;
    const base64 = e.base64;
    if (typeof filename !== 'string' || filename.trim() === '') {
      return { error: { status: 400, body: { error: 'Each file requires filename' } } };
    }
    if (typeof base64 !== 'string' || base64.trim() === '') {
      return { error: { status: 400, body: { error: 'Each file requires base64' } } };
    }
    const basename = path.basename(filename);
    const acceptance = evaluateUploadAcceptance(basename, 'invoices', 'pdf');
    if (!acceptance.accepted) {
      return { error: { status: 400, body: { error: acceptance.reason } } };
    }
    const buf = decodePdfBase64(base64);
    if (!Buffer.isBuffer(buf)) {
      return { error: buf };
    }
    out.push({ filename: basename, buffer: buf });
    totalDecoded += buf.byteLength;
    if (totalDecoded > maxTotalDecoded) {
      return {
        error: {
          status: 413,
          body: {
            error: 'Total decoded payload exceeds invoice MCP batched limit',
            maxTotalBytes: maxTotalDecoded,
          },
        },
      };
    }
  }

  return { files: out };
}
