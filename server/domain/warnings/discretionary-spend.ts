/**
 * Discretionary spend warnings (§1.8): category-level surge and household burn.
 *
 * Rolls up unbudgeted ad-hoc discretionary spend by category, compares against
 * a baseline that excludes the recent window, and nudges toward setting budgets.
 */

import type {
  EntityFoundationWarning,
  WarningSeverity,
} from '../../../shared/api-contracts.js';
import type { Debt } from '../../db/repositories/debts.js';
import type { CategoryName } from '../../utils/categorizer.js';
import type { PipelineResult, RawTransaction } from '../../utils/recurring-pipeline.js';
import { buildRecurringExpenseKeySet, classifyAdHocExpense } from '../../utils/ad-hoc-spend-classifier.js';
import { median, monthKeyFromIsoDate, round2 } from '../../utils/math.js';
import { shiftIsoDate } from '../../../shared/iso-date.js';

export interface DeriveDiscretionarySpendInput {
  readonly today: string;
  readonly expenseTransactions: readonly RawTransaction[];
  readonly pipeline: PipelineResult;
  readonly budgetedCategories: ReadonlySet<string>;
  readonly activeDebts?: readonly Debt[];
}

const WINDOW_30D = 30;
const WINDOW_90D = 90;
const BASELINE_WINDOW_DAYS = 455;
const BASELINE_EXCLUDE_RECENT_DAYS = 90;
const BASELINE_MIN_MONTHS = 3;

export const CATEGORY_SURGE_30D_FLOOR_GBP = 750;
export const CATEGORY_SURGE_30D_CRITICAL_FLOOR_GBP = 1500;
export const CATEGORY_SURGE_MULTIPLE_WARN = 1.5;
export const CATEGORY_SURGE_MULTIPLE_CRITICAL = 2;

export const DISCRETIONARY_BURN_30D_FLOOR_GBP = 2000;
export const DISCRETIONARY_BURN_MULTIPLE_WARN = 1.3;
export const DISCRETIONARY_BURN_MULTIPLE_CRITICAL = 1.75;

interface CategorySpend {
  readonly category: CategoryName;
  readonly isBudgeted: boolean;
  readonly rolling30d: number;
  readonly rolling90d: number;
  readonly prior30d: number;
  readonly baselineMedianMonthly: number;
  readonly baselineAvailable: boolean;
  readonly topMerchants: readonly string[];
  readonly merchantCount90d: number;
}

function aggregateDiscretionaryCategorySpend(
  input: DeriveDiscretionarySpendInput,
): CategorySpend[] {
  const recurringKeys = buildRecurringExpenseKeySet(input.pipeline);

  const win30Start = shiftIsoDate(input.today, -WINDOW_30D);
  const win90Start = shiftIsoDate(input.today, -WINDOW_90D);
  const prior30Start = shiftIsoDate(input.today, -2 * WINDOW_30D);
  const prior30End = win30Start;
  const baselineEndExclusive = shiftIsoDate(input.today, -BASELINE_EXCLUDE_RECENT_DAYS);
  const baselineStart = shiftIsoDate(input.today, -BASELINE_WINDOW_DAYS);

  interface Acc {
    rolling30d: number;
    rolling90d: number;
    prior30d: number;
    baselineByMonth: Map<string, number>;
    merchant90d: Map<string, number>;
  }
  const byCategory = new Map<CategoryName, Acc>();
  const get = (cat: CategoryName): Acc => {
    let a = byCategory.get(cat);
    if (!a) {
      a = {
        rolling30d: 0,
        rolling90d: 0,
        prior30d: 0,
        baselineByMonth: new Map(),
        merchant90d: new Map(),
      };
      byCategory.set(cat, a);
    }
    return a;
  };

  for (const txn of input.expenseTransactions) {
    const adHoc = classifyAdHocExpense(txn, { recurringKeys, activeDebts: input.activeDebts });
    if (adHoc === null) continue;
    const a = get(adHoc.category);
    const d = txn.date;
    if (d >= win30Start && d <= input.today) {
      a.rolling30d += adHoc.absAmount;
    }
    if (d >= win90Start && d <= input.today) {
      a.rolling90d += adHoc.absAmount;
      a.merchant90d.set(
        adHoc.displayMerchant,
        (a.merchant90d.get(adHoc.displayMerchant) ?? 0) + adHoc.absAmount,
      );
    }
    if (d >= prior30Start && d < prior30End) {
      a.prior30d += adHoc.absAmount;
    }
    if (d >= baselineStart && d < baselineEndExclusive) {
      const k = monthKeyFromIsoDate(d);
      a.baselineByMonth.set(k, (a.baselineByMonth.get(k) ?? 0) + adHoc.absAmount);
    }
  }

  const out: CategorySpend[] = [];
  for (const [category, a] of byCategory) {
    const monthly = [...a.baselineByMonth.values()];
    const baselineAvailable = monthly.length >= BASELINE_MIN_MONTHS;
    const topMerchants = [...a.merchant90d.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(e => e[0]);
    out.push({
      category,
      isBudgeted: input.budgetedCategories.has(category),
      rolling30d: round2(a.rolling30d),
      rolling90d: round2(a.rolling90d),
      prior30d: round2(a.prior30d),
      baselineMedianMonthly: baselineAvailable ? round2(median(monthly)) : 0,
      baselineAvailable,
      topMerchants,
      merchantCount90d: a.merchant90d.size,
    });
  }
  return out;
}

export function deriveCategorySpendSurgeWarnings(
  input: DeriveDiscretionarySpendInput,
): EntityFoundationWarning[] {
  const out: { w: EntityFoundationWarning; rolling30d: number; sev: WarningSeverity }[] = [];

  for (const c of aggregateDiscretionaryCategorySpend(input)) {
    if (c.isBudgeted) continue;

    const overFloor = c.rolling30d >= CATEGORY_SURGE_30D_FLOOR_GBP;
    const overBaselineWarn =
      c.baselineAvailable && c.rolling30d >= c.baselineMedianMonthly * CATEGORY_SURGE_MULTIPLE_WARN;
    if (!overFloor && !overBaselineWarn) continue;

    const overBaselineCrit =
      c.baselineAvailable && c.rolling30d >= c.baselineMedianMonthly * CATEGORY_SURGE_MULTIPLE_CRITICAL;
    const sev: WarningSeverity =
      c.rolling30d >= CATEGORY_SURGE_30D_CRITICAL_FLOOR_GBP && overBaselineCrit ? 'critical' : 'warn';

    const momPct = c.prior30d > 0 ? (c.rolling30d - c.prior30d) / c.prior30d : null;
    const ratio =
      c.baselineAvailable && c.baselineMedianMonthly > 0
        ? c.rolling30d / c.baselineMedianMonthly
        : null;

    out.push({
      rolling30d: c.rolling30d,
      sev,
      w: {
        id: `category-spend-surge:${c.category}`,
        code: 'category-spend-surge',
        severity: sev,
        title: `${c.category} spend is surging`,
        detail:
          `£${c.rolling30d} on ${c.category} in the last 30d (£${c.rolling90d} over 90d) across ` +
          `${c.merchantCount90d} merchant${c.merchantCount90d === 1 ? '' : 's'}` +
          (c.topMerchants.length > 0 ? ` (${c.topMerchants.join(', ')})` : '') + '. ' +
          (c.baselineAvailable
            ? `Your usual baseline is ~£${c.baselineMedianMonthly}/month` +
              (ratio !== null ? ` (${ratio.toFixed(1)}x)` : '') + '. '
            : 'No stable baseline yet. ') +
          (momPct !== null ? `Month-on-month: ${Math.round(momPct * 100)}%. ` : '') +
          `Thresholds: warn at £${CATEGORY_SURGE_30D_FLOOR_GBP}/30d or ${CATEGORY_SURGE_MULTIPLE_WARN}x baseline; ` +
          `critical at £${CATEGORY_SURGE_30D_CRITICAL_FLOOR_GBP}/30d and ${CATEGORY_SURGE_MULTIPLE_CRITICAL}x baseline.`,
        recommended_action:
          `${c.category} has no budget. Set a monthly cap so overspend trips a hard budget warning, or reclassify if these are one-offs.`,
        sources: [`category:${c.category}`, 'discretionary-spend'],
        context: {
          category: c.category,
          rolling30d: c.rolling30d,
          rolling90d: c.rolling90d,
          prior30d: c.prior30d,
          baselineMedianMonthly: c.baselineMedianMonthly,
          baselineAvailable: c.baselineAvailable,
          ratioToBaseline: ratio,
          momChangePct: momPct,
          merchantCount90d: c.merchantCount90d,
          topMerchants: c.topMerchants.join(', '),
          threshold30dFloor: CATEGORY_SURGE_30D_FLOOR_GBP,
          threshold30dCriticalFloor: CATEGORY_SURGE_30D_CRITICAL_FLOOR_GBP,
          thresholdMultipleWarn: CATEGORY_SURGE_MULTIPLE_WARN,
          thresholdMultipleCritical: CATEGORY_SURGE_MULTIPLE_CRITICAL,
        },
      },
    });
  }

  out.sort((a, b) => {
    if (a.sev !== b.sev) return a.sev === 'critical' ? -1 : 1;
    return b.rolling30d - a.rolling30d;
  });
  return out.map(o => o.w);
}

export function deriveDiscretionaryBurnWarnings(
  input: DeriveDiscretionarySpendInput,
): EntityFoundationWarning[] {
  const cats = aggregateDiscretionaryCategorySpend(input).filter(c => !c.isBudgeted);
  if (cats.length === 0) return [];

  const total30d = round2(cats.reduce((s, c) => s + c.rolling30d, 0));
  const prior30d = round2(cats.reduce((s, c) => s + c.prior30d, 0));
  const baseline = round2(
    cats.reduce((s, c) => s + (c.baselineAvailable ? c.baselineMedianMonthly : 0), 0),
  );
  const baselineAvailable = cats.some(c => c.baselineAvailable);

  const overFloor = total30d >= DISCRETIONARY_BURN_30D_FLOOR_GBP;
  const overWarn = baselineAvailable && baseline > 0 && total30d >= baseline * DISCRETIONARY_BURN_MULTIPLE_WARN;
  if (!overFloor && !overWarn) return [];

  const overCrit =
    baselineAvailable && baseline > 0 && total30d >= baseline * DISCRETIONARY_BURN_MULTIPLE_CRITICAL;
  const sev: WarningSeverity = overCrit ? 'critical' : 'warn';
  const ratio = baselineAvailable && baseline > 0 ? total30d / baseline : null;
  const momPct = prior30d > 0 ? (total30d - prior30d) / prior30d : null;

  const topCats = [...cats]
    .sort((a, b) => b.rolling30d - a.rolling30d)
    .slice(0, 3)
    .map(c => `${c.category} £${c.rolling30d}`);

  return [{
    id: 'discretionary-burn-elevated',
    code: 'discretionary-burn-elevated',
    severity: sev,
    title: `Unbudgeted discretionary spend is high (£${total30d}/30d)`,
    detail:
      `£${total30d} of discretionary spend in the last 30d across ${cats.length} un-capped categor` +
      `${cats.length === 1 ? 'y' : 'ies'}` +
      (topCats.length > 0 ? ` — top: ${topCats.join(', ')}` : '') + '. ' +
      (baselineAvailable
        ? `Your usual baseline is ~£${baseline}/month` +
          (ratio !== null ? ` (${ratio.toFixed(1)}x)` : '') + '. '
        : 'No stable baseline yet. ') +
      (momPct !== null ? `Month-on-month: ${Math.round(momPct * 100)}%. ` : '') +
      `Thresholds: warn at £${DISCRETIONARY_BURN_30D_FLOOR_GBP}/30d or ${DISCRETIONARY_BURN_MULTIPLE_WARN}x baseline; ` +
      `critical at ${DISCRETIONARY_BURN_MULTIPLE_CRITICAL}x.`,
    recommended_action:
      `${cats.length} discretionary categor${cats.length === 1 ? 'y has' : 'ies have'} no budget. ` +
      `Set monthly caps so this spend converts into hard budget warnings instead of silent drift.`,
    sources: ['discretionary-spend'],
    context: {
      total30d,
      prior30d,
      baselineMonthly: baseline,
      baselineAvailable,
      ratioToBaseline: ratio,
      momChangePct: momPct,
      unbudgetedCategoryCount: cats.length,
      topCategories: topCats.join(', '),
      threshold30dFloor: DISCRETIONARY_BURN_30D_FLOOR_GBP,
      thresholdMultipleWarn: DISCRETIONARY_BURN_MULTIPLE_WARN,
      thresholdMultipleCritical: DISCRETIONARY_BURN_MULTIPLE_CRITICAL,
    },
  }];
}
