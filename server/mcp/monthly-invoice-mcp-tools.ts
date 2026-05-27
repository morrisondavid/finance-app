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

/** @internal MCP contract tests (`invoices_preview_monthly` or alias). */
export function runPreviewMonthlyInvoiceMcpTool(args: unknown): ReturnType<typeof httpReadJsonToMcpToolResult> {
  const r: JsonReadResult = mutateMonthlyInvoicePreview(args ?? {});
  return httpReadJsonToMcpToolResult(r);
}

/** @internal MCP contract tests (`invoices_commit_monthly` or alias). */
export function runCommitMonthlyInvoiceMcpTool(
  args: unknown,
): Promise<ReturnType<typeof httpMutationToMcpToolResult>> {
  return mutateMonthlyInvoiceCommit(args ?? {}).then(httpMutationToMcpToolResult);
}

export function registerMonthlyInvoiceMcpTools(server: McpServer): void {
  const previewDescription =
    'Slice 1 outcome — same core as POST `/api/invoices/monthly/preview`: resolve `contract_id` or monthly supplier-issued target via `client_name`, compose draft, return `previewFingerprint`, occupancy / supplier gap-list hints, and workload vs `days_billed` check.';

  const commitDescription =
    'Slice 1 outcome — POST `/api/invoices/monthly/commit` parity: verifies `previewFingerprint`, optional `allowOutsideGapList`, line overrides (`days_billed`, `description`, `period_end`), then issues via the same path as `/api/invoices/generate` and queues an issued-notice email when Resend env is set.';

  const previewRun = async (raw: unknown) => Promise.resolve(runPreviewMonthlyInvoiceMcpTool(raw));

  server.registerTool(
    'invoices_preview_monthly',
    {
      description: `${previewDescription} **Preferred MCP identifier.** Legacy \`preview_monthly_invoice\` is deprecated.`,
      inputSchema: MonthlyInvoicePreviewBodySchema.shape,
    },
    previewRun,
  );

  server.registerTool(
    'preview_monthly_invoice',
    {
      description: `**Deprecated.** Prefer \`invoices_preview_monthly\`. ${previewDescription}`,
      inputSchema: MonthlyInvoicePreviewBodySchema.shape,
    },
    previewRun,
  );

  const commitRun = async (raw: unknown) => runCommitMonthlyInvoiceMcpTool(raw ?? {});

  server.registerTool(
    'invoices_commit_monthly',
    {
      description: `${commitDescription} **Preferred MCP identifier.** Legacy \`commit_monthly_invoice\` is deprecated.`,
      inputSchema: MonthlyInvoiceCommitBodySchema.shape,
    },
    commitRun,
  );

  server.registerTool(
    'commit_monthly_invoice',
    {
      description: `**Deprecated.** Prefer \`invoices_commit_monthly\`. ${commitDescription}`,
      inputSchema: MonthlyInvoiceCommitBodySchema.shape,
    },
    commitRun,
  );
}
