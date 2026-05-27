import { describe, it, expect } from 'vitest';
import { mutateEnableFeedStart } from '../http/mutation/feed-oauth-start.js';
import { mutateStatementsUploadBase64 } from '../http/mutation/statements-upload-base64.js';
import { httpMutationToMcpToolResult, invoicePdfDownloadToMcpToolResult } from './mcp-mutation-result.js';

describe('Binary / OAuth MCP parity helpers', () => {
  it('OAuth start invalid envelope → MCP tool error envelope', async () => {
    const mut = await mutateEnableFeedStart(null);
    expect(mut.status).toBe(400);
    const mcp = httpMutationToMcpToolResult(mut);
    expect(mcp.isError).toBe(true);
  });

  it('statements base64 empty files batch → HTTP + MCP error', async () => {
    const mut = await mutateStatementsUploadBase64({
      account: 'monzo-joint',
      type: 'csv',
      files: [],
    });
    expect(mut.status).toBe(400);
    const mcp = httpMutationToMcpToolResult(mut);
    expect(mcp.isError).toBe(true);
  });

  it('invoice PDF MCP maps binary to structured pdfBase64', () => {
    const buf = Buffer.from('%PDF-1.4 unit', 'utf8');
    const out = invoicePdfDownloadToMcpToolResult({
      kind: 'pdf',
      filename: 'inv.pdf',
      buffer: buf,
    });
    expect(out.isError).toBeUndefined();
    expect(out.structuredContent?.pdfBase64).toBe(buf.toString('base64'));
    expect(out.structuredContent?.byteLength).toBe(buf.byteLength);
  });

  it('invoice PDF JSON error branch mirrors HTTP status in MCP envelope', () => {
    const out = invoicePdfDownloadToMcpToolResult({
      kind: 'json',
      status: 404,
      body: { error: 'Invoice not found' },
    });
    expect(out.isError).toBe(true);
  });
});
