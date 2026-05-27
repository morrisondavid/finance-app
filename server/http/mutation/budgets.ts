/**
 * Mutations `/api/budgets` POST + DELETE — Express + MCP.
 */

import { BudgetRowSchema, BudgetUpsertBodySchema } from '../../../shared/api-contracts.js';
import { CATEGORY_NAMES, type CategoryName } from '../../utils/categorizer.js';
import { upsertBudget, deleteBudgetById } from '../../db/repositories/budgets.js';
import type { JsonMutationResult } from './types.js';

/** POST `/api/budgets` — upserts SQLite budget row (**persisted**). */
export function mutateBudgetUpsert(body: unknown): JsonMutationResult {
  try {
    const reqBody = BudgetUpsertBodySchema.parse(body);
    if (!CATEGORY_NAMES.includes(reqBody.category as CategoryName)) {
      return { status: 400, body: { error: 'Invalid category' } };
    }
    const row = upsertBudget({
      account: reqBody.account,
      category: reqBody.category as CategoryName,
      amount: reqBody.amount,
      period: reqBody.period,
    });
    return { status: 201, body: BudgetRowSchema.parse(row) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    if (message.includes('Invalid')) {
      return { status: 400, body: { error: message } };
    }
    console.error('[Budgets mutation] POST error:', error);
    return { status: 500, body: { error: 'Failed to save budget' } };
  }
}

/** DELETE `/api/budgets/:id` — 204 No Content on success. */
export function mutateBudgetDelete(idParam: string): JsonMutationResult {
  try {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id < 1) {
      return { status: 400, body: { error: 'Invalid id' } };
    }
    const ok = deleteBudgetById(id);
    if (!ok) {
      return { status: 404, body: { error: 'Budget not found' } };
    }
    return { status: 204, body: null };
  } catch (error) {
    console.error('[Budgets mutation] DELETE error:', error);
    return { status: 500, body: { error: 'Failed to delete budget' } };
  }
}
