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
 *   PUT /api/warnings/user-state
 *     §2.3 — upsert snooze / ack / surface for a warning `fingerprint`.
 */

import express, { Request, Response } from 'express';
import { getDb } from '../db/connection.js';
import { upsertWarningUserState } from '../db/repositories/warning-user-state.js';
import { buildInterCompanyMovementsResponse } from '../domain/inter-company/movements-response.js';
import { classifyInterCompanyPair } from '../domain/transaction-overrides/classify-pair.js';
import {
  InterCompanyMovementsResponseSchema,
  InterCompanyClassifyRequestSchema,
  WarningUserStateUpsertBodySchema,
} from '../../shared/api-contracts.js';
import { sendJsonRead } from '../http/read/send-json-read.js';
import {
  readWarningsConsolidatedFeed,
  readWarningsInterCompanyMovements,
} from '../http/read/warnings-read.js';

const router = express.Router();

router.get('/entity-foundation', (_req: Request, res: Response) => {
  sendJsonRead(res, readWarningsConsolidatedFeed());
});

router.get('/all', (_req: Request, res: Response) => {
  sendJsonRead(res, readWarningsConsolidatedFeed());
});

router.put('/user-state', (req: Request, res: Response) => {
  const parsed = WarningUserStateUpsertBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({
      error: `Invalid user-state body: ${issue.path.join('.') || '(root)'} — ${issue.message}`,
    });
    return;
  }

  try {
    const db = getDb();
    upsertWarningUserState(db, parsed.data);
    res.status(204).end();
  } catch (error) {
    console.error('[Warnings] PUT /user-state error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to upsert warning user-state: ${message}` });
  }
});

router.get('/inter-company-movements', (_req: Request, res: Response) => {
  sendJsonRead(res, readWarningsInterCompanyMovements());
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
