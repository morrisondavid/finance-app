/**
 * Monthly supplier invoice outcome MCP tools — parity with POST /api/invoices/monthly/* .
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  MonthlyInvoiceCommitBodySchema,
  MonthlyInvoicePreviewBodySchema,
  mutateMonthlyInvoiceCommit,
  mutateMonthlyInvoicePreview,
} from '../http/mutation/monthly-invoice-workflow.js';
import type { JsonReadResult } from '../http/read/types.js';

import { httpMutationToMcpToolResult, httpReadJsonToMcpToolResult } from './mcp-mutation-result.js';

/** @internal MCP contract tests. */
export function runPreviewMonthlyInvoiceMcpTool(args: unknown): ReturnType<typeof httpReadJsonToMcpToolResult> {
  const r: JsonReadResult = mutateMonthlyInvoicePreview(args ?? {});
  return httpReadJsonToMcpToolResult(r);
}

/** @internal MCP contract tests. */
export function runCommitMonthlyInvoiceMcpTool(
  args: unknown,
): Promise<ReturnType<typeof httpMutationToMcpToolResult>> {
  return mutateMonthlyInvoiceCommit(args ?? {}).then(httpMutationToMcpToolResult);
}

export function registerMonthlyInvoiceMcpTools(server: McpServer): void {
  server.registerTool(
    'preview_monthly_invoice',
    {
      description:
        'Slice 1 outcome — same core as POST `/api/invoices/monthly/preview`: resolve `contract_id` or monthly supplier-issued target via `client_name`, compose draft, return `previewFingerprint`, occupancy / supplier gap-list hints, and workload vs `days_billed` check.',
      inputSchema: MonthlyInvoicePreviewBodySchema.shape,
    },
    async raw => Promise.resolve(runPreviewMonthlyInvoiceMcpTool(raw)),
  );

  server.registerTool(
    'commit_monthly_invoice',
    {
      description:
        'Slice 1 outcome — POST `/api/invoices/monthly/commit` parity: verifies `previewFingerprint`, optional `allowOutsideGapList`, line overrides (`days_billed`, `description`, `period_end`), then issues via the same path as `/api/invoices/generate` and queues an issued-notice email when Resend env is set.',
      inputSchema: MonthlyInvoiceCommitBodySchema.shape,
    },
    async raw => runCommitMonthlyInvoiceMcpTool(raw ?? {}),
  );
}
