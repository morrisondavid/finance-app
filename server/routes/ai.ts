/**
 * GET /api/ai/* — composed slices for agents (§2.0.E). POST /api/ai/net-worth/snapshot (§3.1)
 * delegates to captureNetWorthSnapshots. Handlers stay thin; see `server/domain/ai/*`.
 */

import { Router, type Request, type Response } from 'express';
import {
  NetWorthSnapshotCaptureBodySchema,
  AiTransactionDrillQuerySchema,
} from '../../shared/api-contracts.js';
import { getDb } from '../db/connection.js';
import { assembleRunway } from '../domain/forecast/index.js';
import { runwayResponseFromAssembled } from '../domain/forecast/runway-api-response.js';
import { buildConsolidatedWarningsResponse } from '../domain/warnings/consolidated-feed.js';
import {
  buildAiManifest,
  composeAiLiquidity,
  composeAiPipeline,
  composeAiSnapshot,
  composeAiFinancialSnapshot,
  composeAiFinancialSafety,
  composeAiIncomeComposition,
  composeAiDebtStrategyState,
  composeAiSpendContext,
  composeAiNetWorthHistory,
  composeAiSpendByCurrency,
  composeAiEntityLiquidityFx,
  composeAiSpendRate,
  composeAiAvailableFunds,
  composeAiUpcoming,
  composeAiSurvival,
  composeAiSpendAllowance,
  buildAiTransactionDrillResponse,
} from '../domain/ai/index.js';
import { captureNetWorthSnapshots } from '../domain/net-worth/snapshot.js';
import type { SpendByCurrencyPeriod } from '../domain/cross-currency/spend-by-currency.js';
import { flattenExpressQuery } from '../utils/flatten-express-query.js';
import {
  FinancialSnapshotQuerySchema,
  HorizonEntityQuerySchema,
  LiquidityQuerySchema,
  RunwayQuerySchema,
  SnapshotQuerySchema,
  SpendByCurrencyQuerySchema,
  SpendRateQuerySchema,
  AvailableFundsQuerySchema,
  UpcomingQuerySchema,
  SurvivalQuerySchema,
  SpendAllowanceQuerySchema,
} from '../domain/ai/ai-get-query-schemas.js';

const router = Router();

/** Drill-specific coercions on `flattenExpressQuery(req.query)`. */
function transactionDrillQueryFromExpress(q: Request['query']): unknown {
  const flat = flattenExpressQuery(q as Record<string, unknown>);
  if (flat.limit !== undefined) {
    flat.limit = Number(flat.limit);
  }
  if (flat.includeRows !== undefined) {
    const v = flat.includeRows;
    flat.includeRows = !(v === 'false' || v === false);
  }
  if (flat.includeTransfers !== undefined) {
    const v = flat.includeTransfers;
    if (v === false || v === 'false') flat.includeTransfers = false;
    else if (v === true || v === 'true') flat.includeTransfers = true;
  }
  return flat;
}

router.get('/spend-by-currency', (req: Request, res: Response) => {
  try {
    const parsed = SpendByCurrencyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }
    const { calendarMonth, financialYear, entityId, account } = parsed.data;
    let period: SpendByCurrencyPeriod;
    if (calendarMonth !== undefined) {
      period = { kind: 'calendarMonth', yearMonth: calendarMonth };
    } else if (financialYear !== undefined) {
      period = { kind: 'financialYear', financialYear };
    } else {
      res.status(400).json({ error: 'Specify calendarMonth or financialYear' });
      return;
    }
    res.json(
      composeAiSpendByCurrency({
        period,
        entityId,
        account,
      }),
    );
  } catch (error) {
    console.error('[AI] GET /spend-by-currency error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI spend-by-currency: ${message}` });
  }
});

router.get('/entity-liquidity-fx', (_req: Request, res: Response) => {
  try {
    res.json(composeAiEntityLiquidityFx());
  } catch (error) {
    console.error('[AI] GET /entity-liquidity-fx error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI entity liquidity: ${message}` });
  }
});

router.get('/transactions-drill', (req: Request, res: Response) => {
  // Optional account and transfer/currency caveats: see AiTransactionDrillQuerySchema in shared/api-contracts.ts and MCP query_transactions description.
  try {
    const parsed = AiTransactionDrillQuerySchema.safeParse(transactionDrillQueryFromExpress(req.query));
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }
    res.json(buildAiTransactionDrillResponse(parsed.data));
  } catch (error) {
    console.error('[AI] GET /transactions-drill error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build transaction drill: ${message}` });
  }
});

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

router.get('/financial-snapshot', (req: Request, res: Response) => {
  try {
    const parsed = FinancialSnapshotQuerySchema.safeParse(req.query);
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
      commitmentDays,
    } = parsed.data;
    res.json(
      composeAiFinancialSnapshot({
        horizonDays,
        commitmentDays,
        filterEntityId,
        runwayDetail,
        account,
        financialYear,
        groupByEntity,
      }),
    );
  } catch (error) {
    console.error('[AI] GET /financial-snapshot error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI financial snapshot: ${message}` });
  }
});

router.get('/financial-safety', (req: Request, res: Response) => {
  try {
    const parsed = FinancialSnapshotQuerySchema.safeParse(req.query);
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
      commitmentDays,
    } = parsed.data;
    res.json(
      composeAiFinancialSafety({
        horizonDays,
        commitmentDays,
        filterEntityId,
        runwayDetail,
        account,
        financialYear,
        groupByEntity,
      }),
    );
  } catch (error) {
    console.error('[AI] GET /financial-safety error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI financial safety: ${message}` });
  }
});

router.get('/net-worth-history', (_req: Request, res: Response) => {
  try {
    res.json(composeAiNetWorthHistory());
  } catch (error) {
    console.error('[AI] GET /net-worth-history error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI net-worth history: ${message}` });
  }
});

router.post('/net-worth/snapshot', (req: Request, res: Response) => {
  try {
    const parsed = NetWorthSnapshotCaptureBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-body', issues: parsed.error.issues });
      return;
    }
    res.json(captureNetWorthSnapshots(parsed.data));
  } catch (error) {
    console.error('[AI] POST /net-worth/snapshot error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to capture net-worth snapshot: ${message}` });
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

router.get('/spend-rate', (req: Request, res: Response) => {
  try {
    const parsed = SpendRateQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }
    res.json(composeAiSpendRate({ window: parsed.data.window, entityId: parsed.data.entityId }));
  } catch (error) {
    console.error('[AI] GET /spend-rate error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI spend-rate: ${message}` });
  }
});

router.get('/available-funds', (req: Request, res: Response) => {
  try {
    const parsed = AvailableFundsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }
    res.json(
      composeAiAvailableFunds({
        horizonDays: parsed.data.days,
        filterEntityId: parsed.data.entityId,
      }),
    );
  } catch (error) {
    console.error('[AI] GET /available-funds error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI available-funds: ${message}` });
  }
});

router.get('/upcoming', (req: Request, res: Response) => {
  try {
    const parsed = UpcomingQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }
    res.json(
      composeAiUpcoming({
        months: parsed.data.months,
        kind: parsed.data.kind,
        filterEntityId: parsed.data.entityId,
      }),
    );
  } catch (error) {
    console.error('[AI] GET /upcoming error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI upcoming: ${message}` });
  }
});

router.get('/survival', (req: Request, res: Response) => {
  try {
    const parsed = SurvivalQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }
    res.json(
      composeAiSurvival({
        scope: parsed.data.scope,
        dailyDiscretionary: parsed.data.dailyDiscretionary,
        targetDate: parsed.data.targetDate,
        horizonDays: parsed.data.horizonDays,
      }),
    );
  } catch (error) {
    console.error('[AI] GET /survival error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI survival: ${message}` });
  }
});

router.get('/spend-allowance', (req: Request, res: Response) => {
  try {
    const parsed = SpendAllowanceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }
    res.json(composeAiSpendAllowance({ period: parsed.data.period }));
  } catch (error) {
    console.error('[AI] GET /spend-allowance error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build AI spend-allowance: ${message}` });
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
