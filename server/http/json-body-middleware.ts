/**
 * Route-aware Express JSON body parser — MCP Streamable HTTP needs a larger limit
 * than typical API mutations (base64 PDF payloads).
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { MCP_HTTP_MOUNT_PATH } from '../mcp/streamable-http-express.js';
import { API_JSON_BODY_LIMIT, MCP_JSON_BODY_LIMIT_BYTES } from '../ingestion/upload-limits.js';

function isMcpHttpPath(req: Request): boolean {
  const p = req.path;
  return p === MCP_HTTP_MOUNT_PATH || p.startsWith(`${MCP_HTTP_MOUNT_PATH}/`);
}

const mcpJsonParser = express.json({ limit: MCP_JSON_BODY_LIMIT_BYTES });
const apiJsonParser = express.json({ limit: API_JSON_BODY_LIMIT });

export function jsonBodyParserMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isMcpHttpPath(req)) {
    mcpJsonParser(req, res, next);
    return;
  }
  apiJsonParser(req, res, next);
}
