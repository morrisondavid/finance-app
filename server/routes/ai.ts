/**
 * GET /api/ai/* — composed slices for agents (§2.0.E). Handlers stay thin;
 * see `server/domain/ai/*` for orchestration.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { EntityIdSchema } from '../../shared/api-contracts.js';
import { getDb } from '../db/connection.js';
import { assembleRunway } from '../domain/forecast/index.js';
import { runwayResponseFromAssembled } from '../domain/forecast/runway-api-response.js';
import { buildConsolidatedWarningsResponse } from '../domain/warnings/consolidated-feed.js';
import {
  buildAiManifest,
  composeAiLiquidity,
  composeAiPipeline,
  composeAiSnapshot,
  composeAiIncomeComposition,
  composeAiDebtStrategyState,
  composeAiSpendContext,
} from '../domain/ai/index.js';

const router = Router();

const EntityQuerySchema = z.object({
  entityId: EntityIdSchema.optional(),
});

const LiquidityQuerySchema = z.object({
  account: z.string().optional(),
  financialYear: z.string().optional(),
  groupByEntity: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform(v => v === 'true'),
});

const HorizonEntityQuerySchema = EntityQuerySchema.extend({
  days: z.coerce.number().int().positive().default(720),
});

const RunwayQuerySchema = HorizonEntityQuerySchema.extend({
  detail: z.enum(['accounts', 'summary']).default('summary'),
});

const SnapshotQuerySchema = RunwayQuerySchema.merge(LiquidityQuerySchema);

router.get('/liquidity', (req: Request, res: Response) => {
  try {
    const parsed = LiquidityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }
    res.json(composeAiLiquidity(parsed.data));
  } catch (error) {
    console.error('[AI] GET /liquidity error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI liquidity: ${message}` });
  }
});

router.get('/pipeline', (req: Request, res: Response) => {
  try {
    const parsed = HorizonEntityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }
    const { days: horizonDays, entityId: filterEntityId } = parsed.data;
    res.json(composeAiPipeline({ horizonDays, filterEntityId }));
  } catch (error) {
    console.error('[AI] GET /pipeline error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI pipeline: ${message}` });
  }
});

router.get('/runway', (req: Request, res: Response) => {
  try {
    const parsed = RunwayQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }
    const { days: horizonDays, entityId: filterEntityId, detail } = parsed.data;
    const assembled = assembleRunway({ horizonDays, filterEntityId });
    const body = runwayResponseFromAssembled(assembled, filterEntityId, { detail });
    res.json(body);
  } catch (error) {
    console.error('[AI] GET /runway error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI runway: ${message}` });
  }
});

router.get('/snapshot', (req: Request, res: Response) => {
  try {
    const parsed = SnapshotQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }
    const {
      days: horizonDays,
      entityId: filterEntityId,
      detail: runwayDetail,
      account,
      financialYear,
      groupByEntity,
    } = parsed.data;
    res.json(
      composeAiSnapshot({
        horizonDays,
        filterEntityId,
        runwayDetail,
        account,
        financialYear,
        groupByEntity,
      }),
    );
  } catch (error) {
    console.error('[AI] GET /snapshot error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI snapshot: ${message}` });
  }
});

router.get('/warnings', (_req: Request, res: Response) => {
  try {
    const body = buildConsolidatedWarningsResponse(getDb());
    res.json(body);
  } catch (error) {
    console.error('[AI] GET /warnings error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI warnings: ${message}` });
  }
});

router.get('/income-composition', (_req: Request, res: Response) => {
  try {
    res.json(composeAiIncomeComposition());
  } catch (error) {
    console.error('[AI] GET /income-composition error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI income composition: ${message}` });
  }
});

router.get('/debt-strategy', (_req: Request, res: Response) => {
  try {
    res.json(composeAiDebtStrategyState());
  } catch (error) {
    console.error('[AI] GET /debt-strategy error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI debt strategy: ${message}` });
  }
});

router.get('/spend-context', (_req: Request, res: Response) => {
  try {
    res.json(composeAiSpendContext());
  } catch (error) {
    console.error('[AI] GET /spend-context error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI spend context: ${message}` });
  }
});

router.get('/manifest', (_req: Request, res: Response) => {
  try {
    res.json(buildAiManifest());
  } catch (error) {
    console.error('[AI] GET /manifest error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI manifest: ${message}` });
  }
});

export default router;
