/**
 * MCP entrypoint — stdio (default) or Streamable HTTP when `MCP_HTTP_PORT` is set.
 *
 * HTTP mode requires `MCP_BEARER_TOKEN` (use a long random secret). Example:
 *   MCP_HTTP_PORT=3344 MCP_BEARER_TOKEN='…' npm run mcp
 */

import http from 'http';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { initDatabase, closeDatabase } from '../db/index.js';
import { createBankStatementsMcpServer } from './bank-mcp-server.js';

function minBearerLength(): number {
  return 16;
}

async function runStreamableHttpMcp(port: number, token: string): Promise<void> {
  await initDatabase();
  const mcp = createBankStatementsMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);

  const app = createMcpExpressApp({ host: '127.0.0.1' });
  app.use('/mcp', (req, res, next) => {
    const hdr = req.headers.authorization;
    if (typeof hdr !== 'string' || hdr !== `Bearer ${token}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });
  app.all('/mcp', (req, res) => {
    void transport.handleRequest(req, res, req.body);
  });

  await new Promise<void>((resolve, reject) => {
    const srv = http.createServer(app);
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => {
      console.log(
        `[MCP] Streamable HTTP http://127.0.0.1:${String(port)}/mcp (Authorization: Bearer …)`,
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
  const token = process.env.MCP_BEARER_TOKEN;
  if (token === undefined || token.length < minBearerLength()) {
    console.error(
      `[MCP] MCP_HTTP_PORT requires MCP_BEARER_TOKEN (min ${String(minBearerLength())} chars)`,
    );
    process.exit(1);
  }
  runStreamableHttpMcp(port, token).catch(err => {
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
