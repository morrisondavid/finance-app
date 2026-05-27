/**
 * Shared envelope for HTTP `res.json(...)` payloads and MCP `structuredContent`,
 * usable from Express handlers and MCP tools that expose the same JSON (same bodies and failure semantics).
 */

export type JsonReadResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; body: unknown };

export function jsonReadOk(body: unknown): JsonReadResult {
  return { ok: true, body };
}

export function jsonReadFail(status: number, body: unknown): JsonReadResult {
  return { ok: false, status, body };
}
