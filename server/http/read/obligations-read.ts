import { getFinancialYearRange, getObligationsPageWindow } from '../../db/utils/financial-year.js';
import { buildVatReconciliationSet } from '../../db/repositories/vat-auto-seed.js';
import {
  getAllObligations,
  getUpcomingObligations,
  getOverdueObligations,
  toApiObligation,
} from '../../db/repositories/obligations.js';
import type {
  ObligationsListResponse,
  VatReconciliationResponse,
  UpcomingObligationsResponse,
  OverdueObligationsResponse,
  UpcomingPaymentsResponse,
  UpcomingPaymentItem,
} from '../../../shared/api-contracts.js';
import { runExpensesOverviewPipeline } from '../../utils/expenses-overview-pipeline.js';
import { buildUpcomingRecurring } from '../../utils/recurring-upcoming.js';
import { listDismissals } from '../../db/repositories/obligation-dismissals.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

export function parseBooleanQueryParam(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  const normalised = value.trim().toLowerCase();
  return normalised === '1' || normalised === 'true' || normalised === 'yes';
}

/** GET /api/obligations */
export function readObligationsRegistry(query: Record<string, unknown>): JsonReadResult {
  try {
    const { status, type, source, hideCompleted, financialYear } = query;
    const window = getObligationsPageWindow();
    const rows = getAllObligations({
      status: typeof status === 'string' ? status : undefined,
      type: typeof type === 'string' ? type : undefined,
      source: typeof source === 'string' ? source : undefined,
      hideCompleted: parseBooleanQueryParam(hideCompleted),
      financialYear: typeof financialYear === 'string' ? financialYear : undefined,
      minDueDate: window.startDate,
      maxDueDate: window.endDate,
    });
    const payload: ObligationsListResponse = { obligations: rows.map(toApiObligation) };
    return jsonReadOk(payload);
  } catch {
    console.error('[Obligations read] GET / error');
    return jsonReadFail(500, { error: 'Failed to fetch obligations' });
  }
}

/** GET /api/obligations/overdue */
export function readObligationsOverdue(): JsonReadResult {
  try {
    const window = getObligationsPageWindow();
    const rows = getOverdueObligations({ minDueDate: window.startDate }, window.today);
    const payload: OverdueObligationsResponse = { obligations: rows.map(toApiObligation) };
    return jsonReadOk(payload);
  } catch {
    console.error('[Obligations read] GET /overdue error');
    return jsonReadFail(500, { error: 'Failed to fetch overdue obligations' });
  }
}

/** GET /api/obligations/vat-reconciliation */
export function readVatReconciliation(query: Record<string, unknown>): JsonReadResult {
  try {
    const fyParamUnknown = Reflect.get(query, 'financialYear');
    const fyParam = typeof fyParamUnknown === 'string' ? fyParamUnknown : undefined;
    const fyRange = fyParam ? getFinancialYearRange(fyParam) : undefined;

    const rows = buildVatReconciliationSet();

    const quarters: VatReconciliationResponse['quarters'] = [];
    for (const { quarter: q, reconciliation: recon } of rows) {
      if (fyRange && (q.endDate < fyRange.startDate || q.startDate > fyRange.endDate)) continue;
      quarters.push({
        quarterLabel: q.label,
        startDate: q.startDate,
        endDate: q.endDate,
        dueDate: q.dueDate,
        quarter: q.quarter,
        expectedAmount: recon.expectedAmount,
        paidAmount: recon.paidAmount,
        paidDate: recon.paidDate,
        paidFromAccount: recon.paidFromAccount,
        status: recon.status,
      });
    }

    quarters.sort((a, b) => a.startDate.localeCompare(b.startDate));
    const payload: VatReconciliationResponse = { quarters };
    return jsonReadOk(payload);
  } catch {
    console.error('[Obligations read] VAT reconciliation error');
    return jsonReadFail(500, { error: 'Failed to generate VAT reconciliation' });
  }
}

/** GET /api/obligations/upcoming */
export function readUpcomingObligations(query: Record<string, unknown>): JsonReadResult {
  try {
    const daysMaybe = Reflect.get(query, 'days');
    const days = parseInt(String(daysMaybe ?? '90'), 10) || 90;
    const window = getObligationsPageWindow();
    const rows = getUpcomingObligations(days, window.today);
    const payload: UpcomingObligationsResponse = { obligations: rows.map(toApiObligation) };
    return jsonReadOk(payload);
  } catch {
    console.error('[Obligations read] GET /upcoming error');
    return jsonReadFail(500, { error: 'Failed to fetch upcoming obligations' });
  }
}

/** GET /api/obligations/upcoming-payments */
export function readUpcomingPaymentsMerged(query: Record<string, unknown>): JsonReadResult {
  try {
    const daysMaybe = Reflect.get(query, 'days');
    const days = parseInt(String(daysMaybe ?? '365'), 10) || 365;
    const window = getObligationsPageWindow();

    const obligationItems: UpcomingPaymentItem[] = [];
    for (const row of getUpcomingObligations(days, window.today)) {
      const dueDate = row.due_date;
      if (dueDate === null) continue;
      obligationItems.push({
        kind: 'obligation',
        id: row.id,
        type: row.type,
        name: row.name,
        entity: row.entity,
        expectedAmount: row.expected_amount,
        dueDate,
        status: row.status,
        source: row.source,
      });
    }

    const pipeline = runExpensesOverviewPipeline();
    const recurring = buildUpcomingRecurring(pipeline, new Date()).thisYear;
    const obligationIds = new Set(
      obligationItems.flatMap(o => (o.kind === 'obligation' ? [o.id] : [])),
    );
    const recurringItems: UpcomingPaymentItem[] = recurring
      .filter(r => r.declaredObligationId === undefined || !obligationIds.has(r.declaredObligationId))
      .map(r => ({
        kind: 'recurring',
        merchant: r.merchant,
        category: r.category,
        colour: r.colour,
        logoUrl: r.logoUrl,
        amount: r.amount,
        sourceAccount: r.sourceAccount,
        nextExpectedDate: r.nextExpectedDate,
      }));

    const items = [...obligationItems, ...recurringItems].sort((a, b) => {
      const dateA = a.kind === 'obligation' ? a.dueDate : a.nextExpectedDate;
      const dateB = b.kind === 'obligation' ? b.dueDate : b.nextExpectedDate;
      return dateA.localeCompare(dateB);
    });

    const payload: UpcomingPaymentsResponse = { items };
    return jsonReadOk(payload);
  } catch {
    console.error('[Obligations read] GET /upcoming-payments error');
    return jsonReadFail(500, { error: 'Failed to fetch upcoming payments' });
  }
}

/** GET /api/obligations/dismissals */
export function readObligationsDismissals(): JsonReadResult {
  try {
    const dismissals = listDismissals();
    return jsonReadOk({ dismissals });
  } catch {
    console.error('[Obligations read] GET /dismissals error');
    return jsonReadFail(500, { error: 'Failed to list dismissals' });
  }
}
