import { describe, it, expect } from 'vitest';
import {
  runPreviewMonthlyInvoiceMcpTool,
} from './monthly-invoice-mcp-tools.js';

describe('MCP preview_monthly_invoice outcome tool', () => {
  it('returns structured fingerprint + occupancy flags for seeded Delta Capita', () => {
    const r = runPreviewMonthlyInvoiceMcpTool({
      contract_id: 'dc-sow-2026',
      billing_month: '2026-04',
    });

    expect(r.isError === true).toBe(false);
    const fp = r.structuredContent?.previewFingerprint;
    expect(typeof fp).toBe('string');
    expect(fp).toHaveLength(64);
    expect(typeof r.structuredContent?.occupancy).toBe('object');
  });

  it('invalid-params envelope when targeting is omitted', () => {
    const r = runPreviewMonthlyInvoiceMcpTool({ billing_month: '2026-04' });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0]?.text ?? '{}')).toMatchObject({
      error: 'Invalid request',
    });
  });
});
