/**
 * @vitest-environment node
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  MCP_HTTP_MOUNT_PATH,
  minMcpBearerUtf8Bytes,
  resolveMcpHttpBearerToken,
} from './streamable-http-express.js';

const ENV_KEY = 'MCP_BEARER_TOKEN';

describe('resolveMcpHttpBearerToken', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
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
