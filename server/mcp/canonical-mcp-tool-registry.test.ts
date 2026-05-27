import { describe, it, expect } from 'vitest';
import { CANONICAL_MCP_TOOL_GROUPS } from './canonical-mcp-tool-registry.js';

const TOOL_NAME = /^[a-z][a-z0-9_]*$/;

describe('CANONICAL_MCP_TOOL_GROUPS', () => {
  it('lists snake_case MCP identifiers only (migration target surface)', () => {
    expect(CANONICAL_MCP_TOOL_GROUPS.length).toBeGreaterThan(0);
    for (const [, tools] of CANONICAL_MCP_TOOL_GROUPS) {
      for (const name of tools) {
        expect(name, `bad tool id: ${name}`).toMatch(TOOL_NAME);
        expect(name, `avoid legacy get_http_* in canonical-only list: ${name}`).not.toMatch(/^get_http_/);
      }
    }
  });
});
