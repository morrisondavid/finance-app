/**
 * GET /api/income-composition — three single-mode-risk metrics + risk
 * signals over the existing income surface (§1.7).
 *
 * Thin route: I/O + pure computation live in
 * [`server/domain/income-composition/assemble.ts`](../domain/income-composition/assemble.ts);
 * this file is just `today` + Zod validation + JSON write. The §1.8
 * warnings spine reuses the same assembler to bridge risk signals
 * onto the warnings tab without duplicating loader code.
 */

import { Router, type Request, type Response } from 'express';
import { IncomeCompositionResponseSchema } from '../../shared/api-contracts.js';
import { todayIsoLocal } from '../../shared/iso-date.js';
import { assembleIncomeComposition } from '../domain/income-composition/index.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  try {
    const today = todayIsoLocal();
    const { sources, composition, riskSignals } = assembleIncomeComposition();

    const body = IncomeCompositionResponseSchema.parse({
      today,
      household: composition.household,
      byEntity: composition.byEntity,
      sources,
      riskSignals,
    });
    res.json(body);
  } catch (error) {
    console.error('[IncomeComposition] GET / error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to build income composition: ${message}` });
  }
});

export default router;
