import { describe, it, expect, afterAll, vi } from 'vitest';
import { createInMemoryTestDb } from '../db/test-harness/in-memory-db.js';
import { mutateDebtsCreate } from '../http/mutation/debts.js';
import { mutateBudgetDelete } from '../http/mutation/budgets.js';
import { mutateInvoiceReconcile } from '../http/mutation/invoices.js';
import { httpMutationToMcpToolResult } from './mcp-mutation-result.js';

const harness = createInMemoryTestDb();

vi.mock('../db/connection.js', () => ({
  getDb: () => harness.db,
}));

afterAll(() => {
  harness.cleanup();
});

describe('HTTP JSON mutation → MCP envelope (parity helpers)', () => {
  it('httpMutationToMcpToolResult treats 204 as success with synthetic structuredContent', () => {
    const mcp = httpMutationToMcpToolResult({ status: 204, body: null });
    expect(mcp.isError).toBeUndefined();
    expect(mcp.structuredContent).toEqual({ noContent: true, httpStatus: 204 });
  });

  it('httpMutationToMcpToolResult sets isError when status ≥ 400', () => {
    const mcp = httpMutationToMcpToolResult({
      status: 422,
      body: { error: 'example' },
    });
    expect(mcp.isError).toBe(true);
    expect(JSON.parse(mcp.content[0].text)).toEqual({ error: 'example' });
  });

  it('mutateDebtsCreate with empty body yields 400 MCP error envelope compatible details', () => {
    const r = mutateDebtsCreate({});
    expect(r.status).toBe(400);
    const mcp = httpMutationToMcpToolResult(r);
    expect(mcp.isError).toBe(true);
  });

  it('mutateBudgetDelete rejects non-positive id without touching DB semantics', () => {
    const r = mutateBudgetDelete('0');
    expect(r.status).toBe(400);
    expect(httpMutationToMcpToolResult(r).isError).toBe(true);
  });

  it('mutateInvoiceReconcile defaults dryRun=true when body omits dryRun', () => {
    const r = mutateInvoiceReconcile({});
    expect(r.status).toBe(200);
    if (r.body === null || typeof r.body !== 'object' || Array.isArray(r.body)) {
      expect.fail('expected reconcile body');
    }
    expect(Reflect.get(r.body, 'dryRun')).toBe(true);
    const mcp = httpMutationToMcpToolResult(r);
    expect(mcp.isError).toBeUndefined();
  });
});
