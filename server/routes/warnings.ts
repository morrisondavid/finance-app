/**
 * /api/warnings — consolidated warnings spine (Roadmap 1.8).
 *
 * Route map:
 *   GET /api/warnings/entity-foundation
 *     The original entity-foundation feed, now extended with §1.6
 *     runway thresholds, §1.7 income-composition risk signals, §1.8
 *     tax-reserve + ad-hoc spend warnings, and snapshot-diff
 *     improvement-feedback entries (`warning-improved` /
 *     `warning-cleared`). The route's name is legacy from §1.1
 *     Phase 7 — its content is the consolidated feed.
 *   GET /api/warnings/all
 *     Alias of the above. Same payload; clearer name for new readers.
 *   GET /api/warnings/inter-company-movements
 *     UK Ltd ↔ UAE FZCO candidate-pair classification queue (Phase 8).
 *   POST /api/warnings/inter-company-movements/classify
 *     Persist a classification for one pair (Phase 8).
 */

import express, { Request, Response } from 'express';
import { getDb } from '../db/connection.js';
import { buildInterCompanyMovementsResponse } from '../domain/inter-company/movements-response.js';
import { classifyInterCompanyPair } from '../domain/transaction-overrides/classify-pair.js';
import { buildConsolidatedWarningsResponse } from '../domain/warnings/consolidated-feed.js';
import {
  InterCompanyMovementsResponseSchema,
  InterCompanyClassifyRequestSchema,
} from '../../shared/api-contracts.js';

const router = express.Router();

async function handleAllWarnings(_req: Request, res: Response): Promise<void> {
  try {
    const db = getDb();
    const body = buildConsolidatedWarningsResponse(db);
    res.json(body);
  } catch (error) {
    console.error('[Warnings] GET /entity-foundation error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to derive entity-foundation warnings: ${message}` });
  }
}

// `/entity-foundation` is the legacy name (§1.1 Phase 7). `/all` is
// the forward-naming alias for §1.8's consolidated spine — same handler,
// same payload. The legacy path stays so existing UI continues to work
// without change.
router.get('/entity-foundation', handleAllWarnings);
router.get('/all', handleAllWarnings);

router.get('/inter-company-movements', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const payload = buildInterCompanyMovementsResponse(db);
    const body = InterCompanyMovementsResponseSchema.parse(payload);
    res.json(body);
  } catch (error) {
    console.error('[Warnings] GET /inter-company-movements error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to list inter-company movements: ${message}` });
  }
});

router.post('/inter-company-movements/classify', (req: Request, res: Response) => {
  const parsed = InterCompanyClassifyRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({
      error: `Invalid classify request: ${issue.path.join('.') || '(root)'} — ${issue.message}`,
    });
    return;
  }

  try {
    const db = getDb();
    const result = classifyInterCompanyPair(db, {
      expenseHash: parsed.data.expenseHash,
      incomeHash: parsed.data.incomeHash,
      category: parsed.data.category,
      notes: parsed.data.notes ?? null,
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const payload = buildInterCompanyMovementsResponse(db);
    const body = InterCompanyMovementsResponseSchema.parse(payload);
    res.json(body);
  } catch (error) {
    console.error('[Warnings] POST /inter-company-movements/classify error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to classify inter-company pair: ${message}` });
  }
});

export default router;
