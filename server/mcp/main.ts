/**
 * MCP entrypoint for **stdio** (Cursor / local Agent) and optional **standalone HTTP** on a
 * separate port when `MCP_HTTP_PORT` is set (local debugging only).
 *
 * Production serves MCP at `GET|POST /mcp` on the main Express app when `MCP_BEARER_TOKEN` is set
 * — see `server/mcp/streamable-http-express.ts` and `server/index.ts`.
 *
 * Stdio example (Cursor `.cursor/mcp.json`):
 *   npm run mcp
 *
 * Standalone HTTP example (local):
 *   MCP_HTTP_PORT=3344 MCP_BEARER_TOKEN='…' npm run mcp
 */

import { loadEnvLocal } from '../load-env-local.js';

loadEnvLocal();

import http from 'http';
import express from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { initDatabase, closeDatabase } from '../db/index.js';
import { createBankStatementsMcpServer } from './bank-mcp-server.js';
import {
  MCP_HTTP_MOUNT_PATH,
  minMcpBearerUtf8Bytes,
  mountStreamableHttpMcp,
  resolveMcpHttpBearerToken,
} from './streamable-http-express.js';

async function runStandaloneHttpMcp(port: number, token: string): Promise<void> {
  await initDatabase();
  const app = express();
  app.use(express.json());
  await mountStreamableHttpMcp(app, token);

  await new Promise<void>((resolve, reject) => {
    const srv = http.createServer(app);
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => {
      console.log(
        `[MCP] Standalone Streamable HTTP http://127.0.0.1:${String(port)}${MCP_HTTP_MOUNT_PATH} (Authorization: Bearer …)`,
      );
      resolve();
    });
  });
}

async function runStdioMcp(): Promise<void> {
  await initDatabase();
  const mcp = createBankStatementsMcpServer();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

const httpPortRaw = process.env.MCP_HTTP_PORT;

if (httpPortRaw !== undefined && httpPortRaw !== '') {
  const port = Number(httpPortRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error('[MCP] MCP_HTTP_PORT must be a valid TCP port');
    process.exit(1);
  }
  let token: string;
  try {
    const resolved = resolveMcpHttpBearerToken();
    if (resolved === null) {
      console.error(
        `[MCP] MCP_HTTP_PORT requires MCP_BEARER_TOKEN (min ${String(minMcpBearerUtf8Bytes())} chars)`,
      );
      process.exit(1);
    }
    token = resolved;
  } catch (err) {
    console.error('[MCP]', err instanceof Error ? err.message : err);
    process.exit(1);
  }
  runStandaloneHttpMcp(port, token).catch(err => {
    console.error('[MCP]', err);
    closeDatabase();
    process.exit(1);
  });
} else {
  runStdioMcp().catch(err => {
    console.error('[MCP]', err);
    closeDatabase();
    process.exit(1);
  });
}
