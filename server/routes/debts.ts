/**
 * /api/debts — CRUD for external creditor debts.
 *
 * All mutating endpoints: validate body with Zod → mutate SQLite via the
 * repository (which also re-exports the canonical debts.csv) → return the
 * refreshed entity so the client can re-render without a second fetch.
 */

import express, { Request, Response } from 'express';
import { z } from 'zod';
import {
  DebtCreateBodySchema,
  DebtUpdateBodySchema,
  DebtOpeningBalanceBodySchema,
} from '../../shared/api-contracts.js';
import {
  listDebts,
  getDebt,
  getDebtSummary,
  getAllDebtSummaries,
  createDebt,
  updateDebt,
  archiveDebt,
  setOpeningDebtBalance,
} from '../db/repositories/debts.js';

const router = express.Router();

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

router.get('/', (req: Request, res: Response) => {
  try {
    const includeArchived = req.query.includeArchived === '1' || req.query.includeArchived === 'true';
    const result = getAllDebtSummaries({ includeArchived });
    res.json(result);
  } catch (error) {
    console.error('[Debts] GET error:', error);
    res.status(500).json({ error: 'Failed to list debts' });
  }
});

router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const debt = getDebt(req.params.id);
    if (!debt) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }
    res.json({ debt: getDebtSummary(debt) });
  } catch (error) {
    console.error('[Debts] GET :id error:', error);
    res.status(500).json({ error: 'Failed to fetch debt' });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const body = DebtCreateBodySchema.parse(req.body);
    const debt = createDebt({
      id: body.id,
      name: body.name,
      merchantPattern: body.merchantPattern,
      sourceAccounts: [...body.sourceAccounts],
      originalLoanAmount: body.originalLoanAmount,
      originalLoanDate: body.originalLoanDate ?? null,
      openingBalance: body.openingBalance,
      openingBalanceDate: body.openingBalanceDate,
      matchAmounts: body.matchAmounts,
      kind: body.kind,
      interestRate: body.interestRate,
      fixedRateEndDate: body.fixedRateEndDate,
      repaymentType: body.repaymentType,
      propertyValueEstimate: body.propertyValueEstimate,
      propertyId: body.propertyId,
    });
    res.status(201).json({ debt: getDebtSummary(debt) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.issues });
      return;
    }
    const msg = errorMessage(error);
    if (msg.includes('already exists') || msg.startsWith('Debt ') || msg.startsWith('Invalid ') || msg.includes('must be')) {
      res.status(400).json({ error: msg });
      return;
    }
    console.error('[Debts] POST error:', error);
    res.status(500).json({ error: 'Failed to create debt' });
  }
});

router.put('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const body = DebtUpdateBodySchema.parse(req.body);
    // listDebts only returns the canonical types we need
    const existing = listDebts({ includeArchived: true }).find(d => d.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }
    const debt = updateDebt(req.params.id, {
      name: body.name,
      merchantPattern: body.merchantPattern,
      sourceAccounts: body.sourceAccounts !== undefined ? [...body.sourceAccounts] : undefined,
      originalLoanAmount: body.originalLoanAmount,
      originalLoanDate: body.originalLoanDate,
      openingBalance: body.openingBalance,
      openingBalanceDate: body.openingBalanceDate,
      archived: body.archived,
      matchAmounts: body.matchAmounts,
      kind: body.kind,
      interestRate: body.interestRate,
      fixedRateEndDate: body.fixedRateEndDate,
      repaymentType: body.repaymentType,
      propertyValueEstimate: body.propertyValueEstimate,
      propertyId: body.propertyId,
    });
    res.json({ debt: getDebtSummary(debt) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.issues });
      return;
    }
    const msg = errorMessage(error);
    if (msg.includes('not found')) {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg.startsWith('Debt ') || msg.startsWith('Invalid ') || msg.includes('must be')) {
      res.status(400).json({ error: msg });
      return;
    }
    console.error('[Debts] PUT error:', error);
    res.status(500).json({ error: 'Failed to update debt' });
  }
});

router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const existing = listDebts({ includeArchived: true }).find(d => d.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }
    const debt = archiveDebt(req.params.id);
    res.json({ debt: getDebtSummary(debt) });
  } catch (error) {
    const msg = errorMessage(error);
    if (msg.includes('not found')) {
      res.status(404).json({ error: msg });
      return;
    }
    console.error('[Debts] DELETE error:', error);
    res.status(500).json({ error: 'Failed to archive debt' });
  }
});

router.post('/:id/opening-balance', (req: Request<{ id: string }>, res: Response) => {
  try {
    const body = DebtOpeningBalanceBodySchema.parse(req.body);
    const existing = listDebts({ includeArchived: true }).find(d => d.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }
    const debt = setOpeningDebtBalance(req.params.id, body.balance, body.date);
    res.json({ debt: getDebtSummary(debt) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.issues });
      return;
    }
    const msg = errorMessage(error);
    if (msg.includes('not found')) {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg.startsWith('Debt ') || msg.startsWith('Invalid ') || msg.includes('must be')) {
      res.status(400).json({ error: msg });
      return;
    }
    console.error('[Debts] opening-balance error:', error);
    res.status(500).json({ error: 'Failed to set opening balance' });
  }
});

export default router;
