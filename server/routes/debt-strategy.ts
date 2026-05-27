/**
 * GET /api/debt-strategy/state — returns the §1.9 bundle.
 * POST /api/debt-strategy/plans — create + activate a plan.
 * POST /api/debt-strategy/plans/:id/activate-suggested — flip a route-only
 *      suggested plan into a persisted active one.
 * POST /api/debt-strategy/plans/:id/movements/:movementId/acknowledge
 * POST /api/debt-strategy/plans/:id/movements/:movementId/dismiss-missed
 * POST /api/debt-strategy/plans/:id/pause | /resume
 * DELETE /api/debt-strategy/plans/:id
 * POST /api/debt-strategy/sandbox — what-if read.
 *
 * Writes delegate to `server/http/mutation/debt-strategy.ts` (same bodies as MCP).
 */

import { Router, type Request, type Response } from 'express';
import { sendJsonRead } from '../http/read/send-json-read.js';
import { readDebtStrategyStateBundle } from '../http/read/debt-strategy-state-read.js';
import { sendJsonMutation } from '../http/mutation/send-json-mutation.js';
import {
  mutateDebtStrategyCreatePlan,
  mutateDebtStrategyActivateSuggested,
  mutateDebtStrategyMovementAcknowledge,
  mutateDebtStrategyMovementDismissMissed,
  mutateDebtStrategyPlanPause,
  mutateDebtStrategyPlanResume,
  mutateDebtStrategyPlanDelete,
  mutateDebtStrategySandbox,
} from '../http/mutation/debt-strategy.js';

const router = Router();

router.get('/state', (_req: Request, res: Response) => {
  sendJsonRead(res, readDebtStrategyStateBundle());
});

router.post('/plans', (req: Request, res: Response) => {
  sendJsonMutation(res, mutateDebtStrategyCreatePlan(req.body));
});

router.post('/plans/:id/activate-suggested', (req: Request, res: Response) => {
  sendJsonMutation(
    res,
    mutateDebtStrategyActivateSuggested(typeof req.params.id === 'string' ? req.params.id : '', req.body),
  );
});

router.post('/plans/:id/movements/:movementId/acknowledge', (req: Request, res: Response) => {
  sendJsonMutation(
    res,
    mutateDebtStrategyMovementAcknowledge(
      typeof req.params.id === 'string' ? req.params.id : '',
      typeof req.params.movementId === 'string' ? req.params.movementId : '',
    ),
  );
});

router.post('/plans/:id/movements/:movementId/dismiss-missed', (req: Request, res: Response) => {
  sendJsonMutation(
    res,
    mutateDebtStrategyMovementDismissMissed(
      typeof req.params.movementId === 'string' ? req.params.movementId : '',
      req.body,
    ),
  );
});

router.post('/plans/:id/pause', (req: Request, res: Response) => {
  sendJsonMutation(
    res,
    mutateDebtStrategyPlanPause(typeof req.params.id === 'string' ? req.params.id : ''),
  );
});

router.post('/plans/:id/resume', (req: Request, res: Response) => {
  sendJsonMutation(
    res,
    mutateDebtStrategyPlanResume(typeof req.params.id === 'string' ? req.params.id : ''),
  );
});

router.delete('/plans/:id', (req: Request, res: Response) => {
  sendJsonMutation(res, mutateDebtStrategyPlanDelete(typeof req.params.id === 'string' ? req.params.id : ''));
});

router.post('/sandbox', (req: Request, res: Response) => {
  sendJsonMutation(res, mutateDebtStrategySandbox(req.body));
});

export default router;
