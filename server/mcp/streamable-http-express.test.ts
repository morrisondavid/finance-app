/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MCP_HTTP_MOUNT_PATH,
  minMcpBearerUtf8Bytes,
  requestBodyIncludesInitialize,
  resolveMcpHttpBearerToken,
} from './streamable-http-express.js';

const ENV_KEY = 'MCP_BEARER_TOKEN';

describe('resolveMcpHttpBearerToken', () => {
  const prior = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (prior === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = prior;
    }
  });

  it('returns null when unset', () => {
    expect(resolveMcpHttpBearerToken()).toBeNull();
  });

  it('returns trimmed token when long enough', () => {
    process.env[ENV_KEY] = '  sixteen-bytes!!!  ';
    expect(resolveMcpHttpBearerToken()).toBe('sixteen-bytes!!!');
  });

  it('throws when token is too short', () => {
    process.env[ENV_KEY] = 'short';
    expect(() => resolveMcpHttpBearerToken()).toThrow(/MCP_BEARER_TOKEN/);
  });

  it('exports stable mount path and minimum length', () => {
    expect(MCP_HTTP_MOUNT_PATH).toBe('/mcp');
    expect(minMcpBearerUtf8Bytes()).toBeGreaterThanOrEqual(16);
  });
});

describe('requestBodyIncludesInitialize', () => {
  it('detects initialize in a single JSON-RPC body', () => {
    expect(
      requestBodyIncludesInitialize({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    ).toBe(true);
  });

  it('detects initialize in a batch body', () => {
    expect(
      requestBodyIncludesInitialize([
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'initialize', params: {} },
      ]),
    ).toBe(true);
  });

  it('returns false for non-initialize requests', () => {
    expect(
      requestBodyIncludesInitialize({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    ).toBe(false);
  });
});
