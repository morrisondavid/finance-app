/**
 * MCP parity for multipart-adjacent routes: OAuth start (URL + state), base64 uploads, invoice PDF as base64.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  EnableFeedStartBodySchema,
  TrueLayerFeedStartBodySchema,
} from '../../shared/api-contracts.js';
import { mutateEnableFeedStart, mutateTrueLayerFeedStart } from '../http/mutation/feed-oauth-start.js';
import { mutateStatementsUploadBase64, MCP_STATEMENT_UPLOAD_MAX_FILES } from '../http/mutation/statements-upload-base64.js';
import { mutateInvoicePdfsUploadFromBase64, MCP_INVOICE_PDF_UPLOAD_MAX_FILES } from '../http/mutation/invoice-upload-base64.js';
import { uploadMaxPdfMiBLabel } from '../ingestion/upload-limits.js';
import { mutateContractSignedPdfDownload } from '../http/mutation/contract-signed-pdf-download.js';
import { todayIsoLocal } from '../../shared/iso-date.js';
import { mutateInvoicePdfDownload } from '../http/mutation/invoice-pdf-download.js';
import {
  httpMutationToMcpToolResult,
  invoicePdfDownloadToMcpToolResult,
  contractSignedPdfToMcpToolResult,
  type HttpMutationMcpToolResult,
} from './mcp-mutation-result.js';

const StatementUploadBase64McpSchema = z.object({
  account: z.string().min(1),
  type: z.enum(['pdf', 'csv']),
  overwrite: z.boolean().optional(),
  files: z
    .array(
      z.object({
        filename: z.string().min(1),
        base64: z.string().min(1),
      }),
    )
    .min(1)
    .max(MCP_STATEMENT_UPLOAD_MAX_FILES),
});

const InvoicePdfsBase64McpSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1),
        base64: z.string().min(1),
      }),
    )
    .min(1)
    .max(MCP_INVOICE_PDF_UPLOAD_MAX_FILES),
});

const InvoicePdfByIdSchema = z.object({
  invoiceId: z.string().min(1),
});

const ContractPdfByIdSchema = z.object({
  contractId: z.string().min(1),
});

export function registerBankStatementsBinaryOAuthUploadTools(server: McpServer): void {
  const dual = (
    canonical: string,
    legacy: string,
    baseDescription: string,
    inputSchema: Record<string, z.ZodTypeAny>,
    handler: (
      raw: Record<string, unknown>,
    ) => HttpMutationMcpToolResult | Promise<HttpMutationMcpToolResult>,
  ): void => {
    const run = async (raw: unknown): Promise<HttpMutationMcpToolResult> =>
      handler((raw ?? {}) as Record<string, unknown>);
    server.registerTool(
      canonical,
      {
        description: `${baseDescription} **Preferred MCP identifier.** Legacy alias \`${legacy}\` is deprecated.`,
        inputSchema,
      },
      run,
    );
    server.registerTool(
      legacy,
      {
        description: `**Deprecated.** Prefer \`${canonical}\`. ${baseDescription}`,
        inputSchema,
      },
      run,
    );
  };

  dual(
    'feed_oauth_enable_start',
    'post_feed_oauth_enable_start',
    'POST /api/feed/enable/start parity. Returns **`url` + `state`** for Enable Banking OAuth. **Human-required:** complete authorization in a browser; callbacks are not available over MCP.',
    EnableFeedStartBodySchema.shape,
    async raw => httpMutationToMcpToolResult(await mutateEnableFeedStart(raw ?? {})),
  );

  dual(
    'feed_oauth_truelayer_start',
    'post_feed_oauth_truelayer_start',
    'POST /api/feed/truelayer/start parity. Returns **`url` + `state`** for TrueLayer OAuth. **Human-required:** open `url` in a browser and finish the redirect flow; MCP cannot receive `/api/feed/truelayer/callback`.',
    TrueLayerFeedStartBodySchema.shape,
    raw => httpMutationToMcpToolResult(mutateTrueLayerFeedStart(raw ?? {})),
  );

  dual(
    'statements_upload_base64',
    'post_upload_statements_base64',
    'POST /api/upload/:account/:type parity via JSON **base64** file payloads (not multipart). Caps: `' +
      String(MCP_STATEMENT_UPLOAD_MAX_FILES) +
      '` files max, **`' +
      uploadMaxPdfMiBLabel() +
      '` decoded per file**; rejects oversize totals. Writes the same disk + ingest workflow as the browser uploader.',
    StatementUploadBase64McpSchema.shape,
    async raw => httpMutationToMcpToolResult(await mutateStatementsUploadBase64(raw ?? {})),
  );

  dual(
    'invoices_upload_supplier_pdfs_base64',
    'post_upload_invoice_pdfs_base64',
    'Self-bill invoice PDF batch (`POST /api/upload/invoices` semantics) via base64 payloads. **`' +
      String(MCP_INVOICE_PDF_UPLOAD_MAX_FILES) +
      '`** PDFs max per call; **`' +
      uploadMaxPdfMiBLabel() +
      '`** decoded cap per PDF (aligned with MCP statement uploads).',
    InvoicePdfsBase64McpSchema.shape,
    async raw =>
      httpMutationToMcpToolResult(await mutateInvoicePdfsUploadFromBase64(raw ?? {}, todayIsoLocal())),
  );

  dual(
    'invoices_get_pdf_base64',
    'get_http_invoice_pdf_base64',
    'GET /api/invoices/:id/pdf parity: returns PDF bytes as **`pdfBase64`** plus `filename`, `mimeType`, `byteLength`. JSON error bodies mirror HTTP 404/500 when the invoice or render is unavailable.',
    InvoicePdfByIdSchema.shape,
    async raw => {
      const parsed = InvoicePdfByIdSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Invalid request', details: parsed.error.issues }, null, 2),
            },
          ],
        };
      }
      const result = await mutateInvoicePdfDownload(parsed.data.invoiceId);
      return invoicePdfDownloadToMcpToolResult(result);
    },
  );

  dual(
    'contracts_get_signed_pdf_base64',
    'get_http_contract_signed_pdf_base64',
    'Signed contract PDF from `clients/contracts/<contractId>.pdf` (**GET /api/contracts/:id/document** semantics) as **`pdfBase64`**. Agents should decode locally for inspection.',
    ContractPdfByIdSchema.shape,
    async raw => {
      const parsed = ContractPdfByIdSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Invalid request', details: parsed.error.issues }, null, 2),
            },
          ],
        };
      }
      const result = mutateContractSignedPdfDownload(parsed.data.contractId);
      return contractSignedPdfToMcpToolResult(result);
    },
  );
}
