import { describe, it, expect } from 'vitest';
import { LeaveListResponseSchema, TaxOverviewResponseSchema } from '../../shared/api-contracts.js';
import { usePopulatedIntegrationDatabase } from '../db/test-harness/use-populated-integration-db.js';
import { leaveForContract } from '../domain/leave/index.js';
import { readContractLeave } from '../http/read/contracts.js';
import { readTaxOverview } from '../http/read/tax-read.js';
import { readWarningsConsolidatedFeed } from '../http/read/warnings-read.js';
import { httpJsonReadToMcpToolResult } from './http-json-read-mcp-tools.js';

describe('HTTP JSON read → MCP envelope (parity)', () => {
  usePopulatedIntegrationDatabase(import.meta.url);

  it('readContractLeave body matches canonical LeaveListResponse (+ MCP envelope)', () => {
    const id = 'dc-sow-2026';
    const fromRead = readContractLeave(id);
    expect(fromRead.ok).toBe(true);
    const expected = LeaveListResponseSchema.parse({ leave: leaveForContract(id) });
    expect(fromRead.body).toEqual(expected);

    const mcp = httpJsonReadToMcpToolResult(fromRead);
    expect(mcp.isError).toBeUndefined();
    expect(mcp.structuredContent).toEqual(expected);
  });

  it('readWarningsConsolidatedFeed MCP structuredContent echoes JSON body (GET /warnings/all parity path)', () => {
    const fromRead = readWarningsConsolidatedFeed();
    expect(fromRead.ok).toBe(true);
    if (!fromRead.ok) {
      expect.fail('expected consolidated warnings read ok');
    }
    const mcp = httpJsonReadToMcpToolResult(fromRead);
    expect(mcp.isError).toBeUndefined();
    expect(mcp.structuredContent).toEqual(fromRead.body);
  });

  it('readTaxOverview MCP envelope matches TaxOverviewResponseSchema', () => {
    const fromRead = readTaxOverview();
    expect(fromRead.ok).toBe(true);
    if (!fromRead.ok) {
      expect.fail('expected tax overview read ok');
    }
    const expected = TaxOverviewResponseSchema.parse(fromRead.body);
    const mcp = httpJsonReadToMcpToolResult(fromRead);
    expect(mcp.isError).toBeUndefined();
    expect(mcp.structuredContent).toEqual(expected);
    expect(expected.selfAssessment.lines.length).toBe(2);
  });

  it('readContractLeave 404 MCP envelope matches jsonReadFail shape', () => {
    const fromRead = readContractLeave('no-such-contract-xyz');
    if (fromRead.ok) {
      expect.fail('expected not ok');
    }
    expect(fromRead.status).toBe(404);

    const mcp = httpJsonReadToMcpToolResult(fromRead);
    expect(mcp.isError).toBe(true);
    expect(JSON.parse(mcp.content[0].text)).toEqual(fromRead.body);
  });
});
