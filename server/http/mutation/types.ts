/**
 * Canonical JSON mutation result for Express + MCP parity (same status + body as HTTP routes).
 */

export type JsonMutationResult = {
  readonly status: number;
  readonly body: unknown;
};
