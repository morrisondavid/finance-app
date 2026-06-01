/**
 * Rolling 12-month committed outflows (obligations + projected fixed recurring)
 * for the dashboard liquidity hero — not tied to the selected financial year.
 */

import type {
  LiquidityCommitmentsOverview,
  ObligationRow,
  RecurringExpense,
} from '../../../shared/api-contracts.js';
import { LiquidityCommitmentsOverviewSchema } from '../../../shared/api-contracts.js';
import { isoDateAddCalendarMonths, shiftIsoDate } from '../../../shared/iso-date.js';
import { getAllObligations, toApiObligation } from '../../db/repositories/obligations.js';
import { round2 } from '../../utils/math.js';
import { runExpensesOverviewPipeline } from '../../utils/expenses-overview-pipeline.js';

/** GBP — lines at or above this are flagged `significant` for save-ahead visibility. */
export const LIQUIDITY_SIGNIFICANT_COMMITMENT_GBP = 2000;

export interface BuildLiquidityCommitmentsInput {
  /** YYYY-MM-DD */
  readonly todayIso: string;
  readonly totalCashGbp: number;
  /** Rolling window length in calendar months. Default 12. */
  readonly months?: number;
}

/** Month keys (YYYY-MM) from the month containing `startYmd` through the month containing `endYmd`, inclusive. */
export function monthKeysInInclusiveRange(startYmd: string, endYmd: string): string[] {
  const keys: string[] = [];
  const [y0, m0] = startYmd.slice(0, 7).split('-').map(Number);
  const endKey = endYmd.slice(0, 7);
  let y = y0;
  let m = m0;
  let key = `${y}-${String(m).padStart(2, '0')}`;
  while (key <= endKey) {
    keys.push(key);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    key = `${y}-${String(m).padStart(2, '0')}`;
  }
  return keys;
}

function horizonLabel(months: number, endYmd: string): string {
  const [yy, mm, dd] = endYmd.split('-').map(Number);
  const d = new Date(yy, mm - 1, dd);
  const pretty = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Next ${months} months (to ${pretty})`;
}

export function obligationRemainingGbpForRow(ob: ObligationRow): number {
  if (ob.dueDate === null) return 0;
  if (ob.expectedAmount === null) return 0;
  const expected = Math.abs(ob.expectedAmount);
  const paid = ob.paidAmount !== null ? Math.abs(ob.paidAmount) : 0;
  return round2(Math.max(0, expected - paid));
}

function daysInCalendarMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/** Next annual bill YYYY-MM-DD on or after `windowStartYmd` within [windowStart, windowEnd], or null. */
function nextAnnualDueInRange(
  row: RecurringExpense,
  windowStartYmd: string,
  windowEndYmd: string,
): string | null {
  if (row.frequency !== 'annual') return null;
  const bm = row.billingMonth;
  const bd = row.billingDayOfMonth;
  if (bm === null || bd === null || bm < 1 || bm > 12) {
    return null;
  }
  const y0 = parseInt(windowStartYmd.slice(0, 4), 10);
  const y1 = parseInt(windowEndYmd.slice(0, 4), 10);
  let best: string | null = null;
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    const dim = daysInCalendarMonth(y, bm);
    const day = Math.min(bd, dim);
    const ymd = `${y}-${String(bm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (ymd >= windowStartYmd && ymd <= windowEndYmd) {
      if (best === null || ymd < best) {
        best = ymd;
      }
    }
  }
  return best;
}

function compareCommitmentLines(
  a: LiquidityCommitmentsOverview['lines'][number],
  b: LiquidityCommitmentsOverview['lines'][number],
): number {
  const src = a.source.localeCompare(b.source);
  if (src !== 0) return src;
  const da = a.dueDate ?? '';
  const db = b.dueDate ?? '';
  if (da !== db) return da.localeCompare(db);
  return a.label.localeCompare(b.label, 'en', { sensitivity: 'base' });
}

function linesFromPipeline(
  todayIso: string,
  horizonEnd: string,
  pipeline: ReturnType<typeof runExpensesOverviewPipeline>,
  monthKeys: readonly string[],
): LiquidityCommitmentsOverview['lines'] {
  const lines: LiquidityCommitmentsOverview['lines'] = [];
  const monthCount = monthKeys.length;
  if (monthCount <= 0) {
    return lines;
  }

  for (const row of pipeline.monthlyExpenseRecurring) {
    if (row.frequency !== 'monthly') continue;
    const projected = round2(row.amount * monthCount);
    if (projected <= 0) continue;
    lines.push({
      label: row.merchant,
      amountGbp: projected,
      source: 'recurring-fixed',
      dueDate: null,
      obligationId: row.declaredObligationId,
      significant: projected >= LIQUIDITY_SIGNIFICANT_COMMITMENT_GBP,
    });
  }

  for (const row of pipeline.annualExpenseRecurring) {
    if (row.frequency !== 'annual') continue;
    const due = nextAnnualDueInRange(row, todayIso, horizonEnd);
    if (due === null) {
      if (row.billingMonth === null || row.billingDayOfMonth === null) {
        const projected = round2(row.amount);
        if (projected > 0) {
          lines.push({
            label: row.merchant,
            amountGbp: projected,
            source: 'recurring-fixed',
            dueDate: null,
            obligationId: row.declaredObligationId,
            significant: projected >= LIQUIDITY_SIGNIFICANT_COMMITMENT_GBP,
          });
        }
      }
      continue;
    }
    const projected = round2(row.amount);
    if (projected > 0) {
      lines.push({
        label: row.merchant,
        amountGbp: projected,
        source: 'recurring-fixed',
        dueDate: due,
        obligationId: row.declaredObligationId,
        significant: projected >= LIQUIDITY_SIGNIFICANT_COMMITMENT_GBP,
      });
    }
  }

  return lines;
}

function linesFromObligations(
  dbRows: ReturnType<typeof getAllObligations>,
): LiquidityCommitmentsOverview['lines'] {
  const lines: LiquidityCommitmentsOverview['lines'] = [];
  for (const row of dbRows) {
    const ob = toApiObligation(row);
    const amountGbp = obligationRemainingGbpForRow(ob);
    if (amountGbp <= 0) continue;
    if (ob.dueDate === null) continue;
    lines.push({
      label: ob.name,
      amountGbp,
      source: 'obligation',
      dueDate: ob.dueDate,
      obligationId: ob.id,
      significant: amountGbp >= LIQUIDITY_SIGNIFICANT_COMMITMENT_GBP,
    });
  }
  return lines;
}

export function buildLiquidityCommitments(input: BuildLiquidityCommitmentsInput): LiquidityCommitmentsOverview {
  const months = input.months ?? 12;
  const horizonStartDate = input.todayIso;
  const horizonEndDate = isoDateAddCalendarMonths(input.todayIso, months);
  const overdueLookback = shiftIsoDate(input.todayIso, -365);
  const dbRows = getAllObligations({
    minDueDate: overdueLookback,
    maxDueDate: horizonEndDate,
    hideCompleted: true,
  });
  const obligationLines = linesFromObligations(dbRows);

  const pipeline = runExpensesOverviewPipeline();
  const monthKeys = monthKeysInInclusiveRange(horizonStartDate, horizonEndDate);
  const recurringLines = linesFromPipeline(horizonStartDate, horizonEndDate, pipeline, monthKeys);

  const lines = [...obligationLines, ...recurringLines].sort(compareCommitmentLines);
  const totalCommittedGbp = round2(lines.reduce((s, l) => s + l.amountGbp, 0));
  const cashAfterCommitmentsGbp = round2(input.totalCashGbp - totalCommittedGbp);

  return LiquidityCommitmentsOverviewSchema.parse({
    horizonStartDate,
    horizonEndDate,
    horizonLabel: horizonLabel(months, horizonEndDate),
    significantThresholdGbp: LIQUIDITY_SIGNIFICANT_COMMITMENT_GBP,
    totalCommittedGbp,
    cashAfterCommitmentsGbp,
    lines,
  });
}
