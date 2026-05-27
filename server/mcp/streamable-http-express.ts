/**
 * Streamable HTTP MCP on Express — production path mounts `/mcp` on the main app.
 * Cursor dev continues to use stdio via `npm run mcp` (`server/mcp/main.ts`).
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { verifyBearer } from '../auth/site-access.js';
import { createBankStatementsMcpServer } from './bank-mcp-server.js';

export const MCP_HTTP_MOUNT_PATH = '/mcp';

const MIN_BEARER_BYTES = 16;

export function minMcpBearerUtf8Bytes(): number {
  return MIN_BEARER_BYTES;
}

/** When set (≥16 UTF-8 bytes), the main Express app mounts Streamable HTTP MCP at `/mcp`. */
export function resolveMcpHttpBearerToken(): string | null {
  const raw = process.env.MCP_BEARER_TOKEN;
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const token = raw.trim();
  if (Buffer.byteLength(token, 'utf8') < MIN_BEARER_BYTES) {
    throw new Error(
      `[MCP] MCP_BEARER_TOKEN must be at least ${String(MIN_BEARER_BYTES)} bytes (UTF-8).`,
    );
  }
  return token;
}

function mcpBearerGate(bearerToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!verifyBearer(req, bearerToken)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}

/**
 * Connect bank MCP and register Streamable HTTP on `mountPath` (default `/mcp`).
 * Call after `initDatabase()` — shares the same SQLite connection as `/api/*`.
 */
export async function mountStreamableHttpMcp(
  app: Express,
  bearerToken: string,
  mountPath: string = MCP_HTTP_MOUNT_PATH,
): Promise<void> {
  const mcp = createBankStatementsMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);

  app.use(mountPath, mcpBearerGate(bearerToken));
  app.all(mountPath, (req: Request, res: Response) => {
    void transport.handleRequest(req, res, req.body);
  });
}
