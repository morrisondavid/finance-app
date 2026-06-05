/**
 * Ad-hoc spend escalation warnings (§1.8).
 *
 * Promotes the existing Dashboard "high-spend merchant without a budget"
 * nudge into a warning when the spend pattern crosses a materiality
 * threshold. Reuses {@link computeBudgetNudges} for the merchant-detection
 * + already-budgeted filter — no parallel detection logic.
 *
 * Two thresholds, one code:
 *   - rolling 30d total ≥ {@link AD_HOC_ROLLING_30D_WARN}
 *     OR rolling 90d total ≥ {@link AD_HOC_ROLLING_90D_WARN}
 *     → severity `warn`.
 *   - additionally MoM velocity ≥ {@link AD_HOC_MOM_CRITICAL_PCT}
 *     (prior-month spend > 0) → severity `critical`.
 *
 * Output is sorted critical → warn, then by 30d total descending.
 */

import type { EntityFoundationWarning, WarningSeverity } from '../../../shared/api-contracts.js';
import type { Debt } from '../../db/repositories/debts.js';
import { computeBudgetNudges, type BudgetNudgeRow } from '../../utils/budget-nudges.js';
import type { PipelineResult, RawTransaction } from '../../utils/recurring-pipeline.js';
import {
  accumulationFromTxn,
  classifyTransactionSide,
} from '../../utils/recurring-pipeline.js';

export const AD_HOC_ROLLING_30D_WARN = 500;
export const AD_HOC_ROLLING_90D_WARN = 1500;
/** Month-on-month relative increase that promotes a warn → critical. */
export const AD_HOC_MOM_CRITICAL_PCT = 0.5;
/** A 30d figure must exceed this to count toward the MoM critical check. */
export const AD_HOC_MOM_BASE_30D = 500;

export interface DeriveAdHocSpendWarningsInput {
  readonly today: string;
  readonly expenseTransactions: readonly RawTransaction[];
  readonly pipeline: PipelineResult;
  readonly budgetedCategories: ReadonlySet<string>;
  readonly activeDebts?: readonly Debt[];
}

interface MerchantTotals {
  readonly merchant: string;
  readonly suggestedCategory: string;
  readonly rolling30dTotal: number;
  readonly rolling90dTotal: number;
  /** Spend in the 30 days BEFORE the recent 30-day window — for MoM math. */
  readonly prior30dTotal: number;
  readonly transactionCount30d: number;
}

function shiftIso(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildTotalsForNudgedMerchants(
  today: string,
  nudges: readonly BudgetNudgeRow[],
  expenseTransactions: readonly RawTransaction[],
): MerchantTotals[] {
  if (nudges.length === 0) return [];

  const win30Start = shiftIso(today, -30);
  const win90Start = shiftIso(today, -90);
  const prior30Start = shiftIso(today, -60);
  const prior30End = win30Start;

  // Reuse the same merchant key the nudge logic uses (`displayMerchant`)
  // so transaction-side and nudge-side bucketing agree exactly.
  const targets = new Map<string, BudgetNudgeRow>();
  for (const n of nudges) targets.set(n.merchant, n);

  interface Bucket {
    rolling30d: number;
    rolling90d: number;
    prior30d: number;
    count30d: number;
  }
  const buckets = new Map<string, Bucket>();

  for (const txn of expenseTransactions) {
    if (classifyTransactionSide(txn) !== 'expense') continue;
    const acc = accumulationFromTxn(txn, 'expense');
    if (!acc) continue;
    const merchant = acc.displayMerchant;
    if (!targets.has(merchant)) continue;

    const absAmount = Math.abs(txn.amount);

    const bucket = buckets.get(merchant) ?? {
      rolling30d: 0,
      rolling90d: 0,
      prior30d: 0,
      count30d: 0,
    };

    if (txn.date >= win30Start && txn.date <= today) {
      bucket.rolling30d += absAmount;
      bucket.count30d += 1;
    }
    if (txn.date >= win90Start && txn.date <= today) {
      bucket.rolling90d += absAmount;
    }
    if (txn.date >= prior30Start && txn.date < prior30End) {
      bucket.prior30d += absAmount;
    }

    buckets.set(merchant, bucket);
  }

  const out: MerchantTotals[] = [];
  for (const [merchant, b] of buckets) {
    const target = targets.get(merchant);
    if (target === undefined) continue;
    out.push({
      merchant,
      suggestedCategory: target.suggestedCategory,
      rolling30dTotal: round2(b.rolling30d),
      rolling90dTotal: round2(b.rolling90d),
      prior30dTotal: round2(b.prior30d),
      transactionCount30d: b.count30d,
    });
  }
  return out;
}

function severityFor(totals: MerchantTotals): WarningSeverity | null {
  const breaches30d = totals.rolling30dTotal >= AD_HOC_ROLLING_30D_WARN;
  const breaches90d = totals.rolling90dTotal >= AD_HOC_ROLLING_90D_WARN;
  if (!breaches30d && !breaches90d) return null;

  if (totals.prior30dTotal > 0 && totals.rolling30dTotal >= AD_HOC_MOM_BASE_30D) {
    const momChange = (totals.rolling30dTotal - totals.prior30dTotal) / totals.prior30dTotal;
    if (momChange >= AD_HOC_MOM_CRITICAL_PCT) return 'critical';
  }
  return 'warn';
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function deriveAdHocSpendWarnings(
  input: DeriveAdHocSpendWarningsInput,
): EntityFoundationWarning[] {
  const nudges = computeBudgetNudges({
    expenseTransactions: input.expenseTransactions,
    pipeline: input.pipeline,
    budgetedCategories: input.budgetedCategories,
    activeDebts: input.activeDebts,
    options: { minTotal: 0, maxRows: 50 },
  });

  const allTotals = buildTotalsForNudgedMerchants(input.today, nudges, input.expenseTransactions);

  const out: { warning: EntityFoundationWarning; rolling30dTotal: number; severity: WarningSeverity }[] = [];

  for (const totals of allTotals) {
    const severity = severityFor(totals);
    if (severity === null) continue;

    const momChange =
      totals.prior30dTotal > 0
        ? (totals.rolling30dTotal - totals.prior30dTotal) / totals.prior30dTotal
        : null;

    const detail =
      `${totals.merchant} (suggested category: ${totals.suggestedCategory}) — ` +
      `${totals.rolling30dTotal} in the last 30d, ${totals.rolling90dTotal} in the last 90d ` +
      `over ${totals.transactionCount30d} transactions in the last 30d. ` +
      (momChange !== null ? `Month-on-month change: ${fmtPct(momChange)}. ` : 'No prior-month baseline. ') +
      `Threshold for warn: 30d ≥ ${AD_HOC_ROLLING_30D_WARN} or 90d ≥ ${AD_HOC_ROLLING_90D_WARN}; ` +
      `MoM critical if change ≥ ${fmtPct(AD_HOC_MOM_CRITICAL_PCT)}.`;

    const recommendedAction =
      severity === 'critical'
        ? `Spend on ${totals.merchant} is accelerating fast and is unbudgeted. Set a cap (or reclassify the spend) before it eats more of the discretionary budget.`
        : `Spend on ${totals.merchant} is material and unbudgeted. Add a budget line, reclassify, or accept and track.`;

    out.push({
      warning: {
        id: `ad-hoc-spend-escalating:${totals.merchant}`,
        code: 'ad-hoc-spend-escalating',
        severity,
        title: `Unbudgeted spend on ${totals.merchant} is escalating`,
        detail,
        recommended_action: recommendedAction,
        sources: [`merchant:${totals.merchant}`, 'budget-nudges'],
        context: {
          merchant: totals.merchant,
          suggestedCategory: totals.suggestedCategory,
          rolling30dTotal: totals.rolling30dTotal,
          rolling90dTotal: totals.rolling90dTotal,
          prior30dTotal: totals.prior30dTotal,
          momChangePct: momChange,
          transactionCount30d: totals.transactionCount30d,
          threshold30d: AD_HOC_ROLLING_30D_WARN,
          threshold90d: AD_HOC_ROLLING_90D_WARN,
          thresholdMoMCriticalPct: AD_HOC_MOM_CRITICAL_PCT,
        },
      },
      rolling30dTotal: totals.rolling30dTotal,
      severity,
    });
  }

  out.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === 'critical' ? -1 : 1;
    }
    return b.rolling30dTotal - a.rolling30dTotal;
  });
  return out.map(o => o.warning);
}
