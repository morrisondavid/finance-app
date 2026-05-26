import { describe, it, expect } from 'vitest';
import { runQueryTransactionsMcpTool } from './bank-mcp-server.js';

describe('runQueryTransactionsMcpTool', () => {
  it('returns isError when drill query omits required date window', () => {
    const r = runQueryTransactionsMcpTool({ limit: 5 });
    expect(r.isError).toBe(true);
  });
});
