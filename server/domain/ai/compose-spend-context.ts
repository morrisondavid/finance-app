import { AiSpendContextResponseSchema } from '../../../shared/api-contracts.js';
import { ACCOUNTS } from '../../../shared/api-contracts.js';
import { getAvailableFinancialYears } from '../../db/index.js';
import {
  buildAdHocExpensesResponse,
  buildExpensesOverviewSheetResponse,
  buildRecurringExpensesResponse,
} from '../expenses/read-response-builders.js';

/**
 * Single nested payload matching default-first-account + default FY behaviour
 * of `GET /api/expenses/overview`, `/recurring`, and `/ad-hoc`.
 */
export function composeAiSpendContext() {
  const overview = buildExpensesOverviewSheetResponse();
  const recurring = buildRecurringExpensesResponse();

  const allYears = getAvailableFinancialYears();
  const selectedFY = allYears[0] || '';
  const adHocResult = buildAdHocExpensesResponse({
    account: ACCOUNTS[0],
    financialYear: selectedFY === '' ? null : selectedFY,
  });
  if ('error' in adHocResult) {
    throw new Error(`spend-context ad-hoc: ${adHocResult.error}`);
  }

  return AiSpendContextResponseSchema.parse({
    overview,
    recurring,
    adHoc: adHocResult,
  });
}
