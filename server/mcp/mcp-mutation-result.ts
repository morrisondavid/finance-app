/**
 * Maps {@link JsonMutationResult} to MCP tool results (aligns with HTTP status semantics).
 */

import type { InvoicePdfDownloadMutationResult } from '../http/mutation/invoice-pdf-download.js';
import type { JsonMutationResult } from '../http/mutation/types.js';

export type HttpMutationMcpToolResult = {
  isError?: true;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
};

function structuredRecordFromJsonBody(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(body)) {
    if (typeof key === 'string') {
      out[key] = Reflect.get(body, key);
    }
  }
  return out;
}

/**
 * MCP wrapper for invoice PDF retrieval: success returns **base64** (same binary as GET /api/invoices/:id/pdf).
 */
export function invoicePdfDownloadToMcpToolResult(r: InvoicePdfDownloadMutationResult): HttpMutationMcpToolResult {
  if (r.kind === 'json') {
    return httpMutationToMcpToolResult({ status: r.status, body: r.body });
  }

  const structuredContent: Record<string, unknown> = {
    filename: r.filename,
    mimeType: 'application/pdf',
    byteLength: r.buffer.byteLength,
    pdfBase64: r.buffer.toString('base64'),
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

export function httpMutationToMcpToolResult(r: JsonMutationResult): HttpMutationMcpToolResult {
  const text =
    r.status === 204
      ? JSON.stringify({ noContent: true, httpStatus: 204 }, null, 2)
      : JSON.stringify(r.body, null, 2);

  if (r.status >= 400) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text }],
    };
  }

  const structuredContent =
    r.status === 204 ? { noContent: true, httpStatus: 204 } : structuredRecordFromJsonBody(r.body);

  return {
    content: [{ type: 'text' as const, text }],
    ...(structuredContent !== undefined ? { structuredContent } : {}),
  };
}
