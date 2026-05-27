/**
 * GET `/api/budgets/category-names` and `/api/budgets` list — Express + MCP.
 */

import { CATEGORY_NAMES } from '../../utils/categorizer.js';
import { validateAccount } from '../../domain/accounts/index.js';
import { listBudgets } from '../../db/repositories/budgets.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

export function readBudgetCategoryNames(): JsonReadResult {
  try {
    return jsonReadOk({ categories: [...CATEGORY_NAMES] });
  } catch (error) {
    console.error('[Budgets read] category-names error:', error);
    return jsonReadFail(500, { error: 'Failed to read category names' });
  }
}

interface BudgetLinesQuery {
  account?: string | undefined;
}

export function readBudgetLinesFromQuery(query: BudgetLinesQuery): JsonReadResult {
  try {
    const selectedAccount = validateAccount(query.account);
    const budgets = listBudgets({ account: selectedAccount });
    return jsonReadOk({ budgets });
  } catch (error) {
    console.error('[Budgets read] list error:', error);
    return jsonReadFail(500, { error: 'Failed to list budgets' });
  }
}
