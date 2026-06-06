/**
 * Shared upload size limits — browser multipart, MCP base64 JSON, and Express body parsing.
 */

export const MCP_JSON_BODY_LIMIT_BYTES = 32 * 1024 * 1024;
export const API_JSON_BODY_LIMIT = '2mb';

/** Decoded PDF max — fits one PDF in a 32 MiB MCP JSON body (base64 ≈ 4/3× raw). */
export const UPLOAD_MAX_PDF_BYTES = Math.floor((MCP_JSON_BODY_LIMIT_BYTES * 3) / 4);

export const UPLOAD_MAX_CSV_BYTES = 15 * 1024 * 1024;

/** Browser multipart batch cap (matches historical `upload.array('files', 50)`). */
export const UPLOAD_MAX_FILES_PER_REQUEST = 50;

export const MCP_STATEMENT_UPLOAD_MAX_FILES = 10;
export const MCP_INVOICE_PDF_UPLOAD_MAX_FILES = 5;

export function mcpStatementUploadMaxBytesForType(type: 'pdf' | 'csv'): number {
  return type === 'pdf' ? UPLOAD_MAX_PDF_BYTES : UPLOAD_MAX_CSV_BYTES;
}

export function mcpStatementUploadMaxTotalBytes(): number {
  return UPLOAD_MAX_PDF_BYTES * MCP_STATEMENT_UPLOAD_MAX_FILES;
}

export function mcpInvoiceUploadMaxTotalBytes(): number {
  return UPLOAD_MAX_PDF_BYTES * MCP_INVOICE_PDF_UPLOAD_MAX_FILES;
}

export function uploadMaxPdfMiBLabel(): string {
  const mib = Math.floor(UPLOAD_MAX_PDF_BYTES / (1024 * 1024));
  return `${String(mib)}MiB`;
}
