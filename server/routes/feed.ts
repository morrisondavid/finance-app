/**
 * `POST /api/feed/sync` — single endpoint that triggers an automated AISP
 * sync for one account.
 *
 * The handler is intentionally thin: parse + dispatch + map errors. All
 * domain logic lives in `runFeedSync` (which the MCP tool also calls), so
 * "thin handler + thin tool, one shared engine" — same pattern the §3.1
 * net-worth snapshot uses.
 *
 * Request body (Zod-validated): `{ account, dateFrom, dateTo?, force? }`.
 * `dateFrom` is **required by design** — see §3.4 plan; we never invent a
 * window start.
 *
 * Response shape: `FeedSyncResponseSchema` from `shared/api-contracts.ts`,
 * shared with the MCP tool.
 *
 * Error mapping (so callers see meaningful 4xx codes, not 500s):
 *   - Body fails Zod parse           → 400
 *   - `FeedSyncError` (not-linked /  → 422 (config not ready)
 *      no-emitter / unknown-account)
 *   - `EnableBankingError` (no-      → 401 (operator must re-link)
 *      session / expired-session)
 *   - `EnableBankingError` (missing- → 503 (server config gap)
 *      credentials / http-error /
 *      invalid-response)
 *   - Anything else                  → 500
 */

import express, { Request, Response } from 'express';
import {
  FeedSyncBodySchema,
  FeedSyncResponseSchema,
  type FeedSyncResponse,
} from '../../shared/api-contracts.js';
import { runFeedSync, FeedSyncError } from '../ingestion/feeds/sync.js';
import { EnableBankingError } from '../ingestion/feeds/enable-banking.js';
import enableOAuthRouter from './enable-oauth.js';

const router = express.Router();

router.use(enableOAuthRouter);

interface ErrorBody {
  error: string;
  code?: string;
  details?: unknown;
}

function mapError(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof FeedSyncError) {
    return {
      status: 422,
      body: { error: err.message, code: err.code },
    };
  }
  if (err instanceof EnableBankingError) {
    if (err.code === 'no-session' || err.code === 'expired-session') {
      return { status: 401, body: { error: err.message, code: err.code } };
    }
    if (err.code === 'missing-credentials') {
      return { status: 503, body: { error: err.message, code: err.code } };
    }
    return { status: 502, body: { error: err.message, code: err.code } };
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  return { status: 500, body: { error: message } };
}

router.post('/sync', async (req: Request, res: Response<FeedSyncResponse | ErrorBody>) => {
  const parsed = FeedSyncBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid feed sync request body',
      details: parsed.error.issues,
    });
    return;
  }

  try {
    const result = await runFeedSync(parsed.data.account, {
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      force: parsed.data.force,
    });
    // Re-parse on the way out so the wire shape is locked to the schema —
    // matches the pattern used by the net-worth snapshot route.
    res.json(FeedSyncResponseSchema.parse(result));
  } catch (err) {
    const mapped = mapError(err);
    res.status(mapped.status).json(mapped.body);
  }
});

export default router;
