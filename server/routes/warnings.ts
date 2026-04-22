/**
 * /api/warnings — a read-only projection over the app's warning
 * surfaces (Roadmap 1.8). For now two slices are wired up:
 *
 * Route map:
 *   GET /api/warnings/entity-foundation — derive and return the list
 *     of entity-foundation warnings (TBC fields, FZCO CT blockers,
 *     UAE VAT thresholds, IFZA renewal, inter-company movement
 *     classification).
 *   GET /api/warnings/inter-company-movements — list every detected
 *     UK Ltd ↔ UAE FZCO candidate pair, annotated with its current
 *     classification (Phase 8).
 *   POST /api/warnings/inter-company-movements/classify — persist a
 *     classification for one pair (Phase 8).
 */

import express, { Request, Response } from 'express';
import { getDb } from '../db/connection.js';
import { allCompanies } from '../domain/company/index.js';
import { deriveEntityFoundationWarnings } from '../domain/warnings/entity-foundation.js';
import { sumFzcoTrailing12mIncomeAed } from '../domain/warnings/fzco-income.js';
import { countUnclassifiedInterCompanyPairs } from '../domain/warnings/inter-company-count.js';
import { buildInterCompanyMovementsResponse } from '../domain/inter-company/movements-response.js';
import { classifyInterCompanyPair } from '../domain/transaction-overrides/classify-pair.js';
import {
  EntityFoundationWarningsResponseSchema,
  InterCompanyMovementsResponseSchema,
  InterCompanyClassifyRequestSchema,
} from '../../shared/api-contracts.js';

const router = express.Router();

router.get('/entity-foundation', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = new Date();

    const warnings = deriveEntityFoundationWarnings({
      companies: allCompanies(),
      fzcoTrailing12mIncomeAed: sumFzcoTrailing12mIncomeAed(db, today),
      interCompanyMovementCount: countUnclassifiedInterCompanyPairs(db),
      today,
    });

    const body = EntityFoundationWarningsResponseSchema.parse({
      warnings,
    });
    res.json(body);
  } catch (error) {
    console.error('[Warnings] GET /entity-foundation error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to derive entity-foundation warnings: ${message}` });
  }
});

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
