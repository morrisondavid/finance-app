/**
 * Mutations backing POST/PUT/DELETE `/api/debts*` — Express + MCP.
 */

import { z } from 'zod';
import {
  DebtCreateBodySchema,
  DebtOpeningBalanceBodySchema,
  DebtUpdateBodySchema,
} from '../../../shared/api-contracts.js';
import {
  listDebts,
  getDebtSummary,
  createDebt,
  updateDebt,
  archiveDebt,
  setOpeningDebtBalance,
} from '../../db/repositories/debts.js';
import type { JsonMutationResult } from './types.js';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

/** POST `/api/debts` — **persists debt row**. */
export function mutateDebtsCreate(body: unknown): JsonMutationResult {
  try {
    const reqBody = DebtCreateBodySchema.parse(body);
    const debt = createDebt({
      id: reqBody.id,
      name: reqBody.name,
      merchantPattern: reqBody.merchantPattern,
      sourceAccounts: [...reqBody.sourceAccounts],
      originalLoanAmount: reqBody.originalLoanAmount,
      originalLoanDate: reqBody.originalLoanDate ?? null,
      openingBalance: reqBody.openingBalance,
      openingBalanceDate: reqBody.openingBalanceDate,
      matchAmounts: reqBody.matchAmounts,
      kind: reqBody.kind,
      interestRate: reqBody.interestRate,
      fixedRateEndDate: reqBody.fixedRateEndDate,
      repaymentType: reqBody.repaymentType,
      propertyValueEstimate: reqBody.propertyValueEstimate,
      propertyId: reqBody.propertyId,
    });
    return { status: 201, body: { debt: getDebtSummary(debt) } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 400, body: { error: 'Invalid request', details: error.issues } };
    }
    const msg = errorMessage(error);
    if (
      msg.includes('already exists') ||
      msg.startsWith('Debt ') ||
      msg.startsWith('Invalid ') ||
      msg.includes('must be')
    ) {
      return { status: 400, body: { error: msg } };
    }
    console.error('[Debts mutation] POST error:', error);
    return { status: 500, body: { error: 'Failed to create debt' } };
  }
}

/** PUT `/api/debts/:id` — **updates debt CSV**. */
export function mutateDebtsUpdate(id: string, body: unknown): JsonMutationResult {
  try {
    const reqBody = DebtUpdateBodySchema.parse(body);
    const existing = listDebts({ includeArchived: true }).find(d => d.id === id);
    if (!existing) {
      return { status: 404, body: { error: 'Debt not found' } };
    }
    const debt = updateDebt(id, {
      name: reqBody.name,
      merchantPattern: reqBody.merchantPattern,
      sourceAccounts:
        reqBody.sourceAccounts !== undefined ? [...reqBody.sourceAccounts] : undefined,
      originalLoanAmount: reqBody.originalLoanAmount,
      originalLoanDate: reqBody.originalLoanDate,
      openingBalance: reqBody.openingBalance,
      openingBalanceDate: reqBody.openingBalanceDate,
      archived: reqBody.archived,
      matchAmounts: reqBody.matchAmounts,
      kind: reqBody.kind,
      interestRate: reqBody.interestRate,
      fixedRateEndDate: reqBody.fixedRateEndDate,
      repaymentType: reqBody.repaymentType,
      propertyValueEstimate: reqBody.propertyValueEstimate,
      propertyId: reqBody.propertyId,
    });
    return { status: 200, body: { debt: getDebtSummary(debt) } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 400, body: { error: 'Invalid request', details: error.issues } };
    }
    const msg = errorMessage(error);
    if (msg.includes('not found')) {
      return { status: 404, body: { error: msg } };
    }
    if (msg.startsWith('Debt ') || msg.startsWith('Invalid ') || msg.includes('must be')) {
      return { status: 400, body: { error: msg } };
    }
    console.error('[Debts mutation] PUT error:', error);
    return { status: 500, body: { error: 'Failed to update debt' } };
  }
}

/** DELETE `/api/debts/:id` — archives debt. */
export function mutateDebtsArchive(id: string): JsonMutationResult {
  try {
    const existing = listDebts({ includeArchived: true }).find(d => d.id === id);
    if (!existing) {
      return { status: 404, body: { error: 'Debt not found' } };
    }
    const debt = archiveDebt(id);
    return { status: 200, body: { debt: getDebtSummary(debt) } };
  } catch (error) {
    const msg = errorMessage(error);
    if (msg.includes('not found')) {
      return { status: 404, body: { error: msg } };
    }
    console.error('[Debts mutation] DELETE error:', error);
    return { status: 500, body: { error: 'Failed to archive debt' } };
  }
}

/** POST `/api/debts/:id/opening-balance`. */
export function mutateDebtsOpeningBalance(id: string, body: unknown): JsonMutationResult {
  try {
    const reqBody = DebtOpeningBalanceBodySchema.parse(body);
    const existing = listDebts({ includeArchived: true }).find(d => d.id === id);
    if (!existing) {
      return { status: 404, body: { error: 'Debt not found' } };
    }
    const debt = setOpeningDebtBalance(id, reqBody.balance, reqBody.date);
    return { status: 200, body: { debt: getDebtSummary(debt) } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 400, body: { error: 'Invalid request', details: error.issues } };
    }
    const msg = errorMessage(error);
    if (msg.includes('not found')) {
      return { status: 404, body: { error: msg } };
    }
    if (msg.startsWith('Debt ') || msg.startsWith('Invalid ') || msg.includes('must be')) {
      return { status: 400, body: { error: msg } };
    }
    console.error('[Debts mutation] opening-balance error:', error);
    return { status: 500, body: { error: 'Failed to set opening balance' } };
  }
}
