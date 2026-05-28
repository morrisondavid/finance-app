/**
 * Streamable HTTP MCP on Express — production path mounts `/mcp` on the main app.
 * Cursor dev continues to use stdio via `npm run mcp` (`server/mcp/main.ts`).
 */

import crypto from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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

interface McpHttpSession {
  readonly server: McpServer;
  readonly transport: StreamableHTTPServerTransport;
}

function readMcpSessionIdHeader(req: Request): string | undefined {
  const raw = req.headers['mcp-session-id'];
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim();
  }
  if (Array.isArray(raw)) {
    const first = raw.find(v => typeof v === 'string' && v.trim() !== '');
    return first?.trim();
  }
  return undefined;
}

export function requestBodyIncludesInitialize(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(message => {
    if (message === null || typeof message !== 'object') {
      return false;
    }
    return (message as { method?: unknown }).method === 'initialize';
  });
}

async function createMcpHttpSession(
  sessions: Map<string, McpHttpSession>,
): Promise<McpHttpSession> {
  const server = createBankStatementsMcpServer();
  let session: McpHttpSession | undefined;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sessionId) => {
      if (session !== undefined) {
        sessions.set(sessionId, session);
      }
    },
    onsessionclosed: (sessionId) => {
      sessions.delete(sessionId);
      void session?.server.close();
    },
  });
  session = { server, transport };
  await server.connect(transport);
  return session;
}

async function resolveMcpHttpSession(
  req: Request,
  sessions: Map<string, McpHttpSession>,
): Promise<McpHttpSession | null> {
  const sessionId = readMcpSessionIdHeader(req);
  if (sessionId !== undefined) {
    return sessions.get(sessionId) ?? null;
  }
  if (!requestBodyIncludesInitialize(req.body)) {
    return null;
  }
  return createMcpHttpSession(sessions);
}

/**
 * Connect bank MCP and register Streamable HTTP on `mountPath` (default `/mcp`).
 * Call after `initDatabase()` — shares the same SQLite connection as `/api/*`.
 *
 * Uses stateful Streamable HTTP sessions (one transport per client). Stateless mode
 * (`sessionIdGenerator: undefined`) only allows a single HTTP request per transport.
 */
export async function mountStreamableHttpMcp(
  app: Express,
  bearerToken: string,
  mountPath: string = MCP_HTTP_MOUNT_PATH,
): Promise<void> {
  const sessions = new Map<string, McpHttpSession>();

  app.use(mountPath, mcpBearerGate(bearerToken));
  app.all(mountPath, (req: Request, res: Response) => {
    void (async () => {
      try {
        const session = await resolveMcpHttpSession(req, sessions);
        if (session === null) {
          res.status(400).json({ error: 'Missing or unknown MCP session' });
          return;
        }
        await session.transport.handleRequest(req, res, req.body);
      } catch (err) {
        console.error('[MCP] handleRequest failed:', err);
        if (!res.headersSent) {
          res.status(500).type('text/plain').send('Internal Server Error');
        }
      }
    })();
  });
}
