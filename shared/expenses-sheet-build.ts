/**
 * Build and adjust Fixed Expenses sheet payloads (shared by server and browser).
 */

import type {
  ExpensesLineItem,
  ExpensesSection,
  ExpensesSheetResponse,
} from './api-contracts.js';
import { buildExpensesInsight, computeYearlyFixedInsightFigures } from './expenses-insight.js';
import { round2 } from './math-round.js';
import { SPECIAL_CATEGORY } from './special-category.js';

function included(item: ExpensesLineItem, excluded: ReadonlySet<string>): boolean {
  return !excluded.has(item.lineKey);
}

function sectionSubtotal(sec: ExpensesSection, excluded: ReadonlySet<string>): number {
  return round2(sec.items.filter((i) => included(i, excluded)).reduce((s, i) => s + i.amount, 0));
}

function incomeTotal(items: readonly ExpensesLineItem[], excluded: ReadonlySet<string>): number {
  return round2(items.filter((i) => included(i, excluded)).reduce((s, i) => s + i.amount, 0));
}

/** Aggregate monthly outgoings splits from line items (same rules as expenses route). */
function computeMonthlyOutgoingSplits(
  monthlyOutgoings: ExpensesSection[],
  excluded: ReadonlySet<string>,
): { personalMonthlyFixed: number; businessMonthlyFixed: number; debtMonthlyFixed: number } {
  let personalMonthlyFixed = 0;
  let businessMonthlyFixed = 0;
  let debtMonthlyFixed = 0;
  for (const sec of monthlyOutgoings) {
    for (const item of sec.items) {
      if (!included(item, excluded)) continue;
      if (item.accountCategory === 'business') {
        businessMonthlyFixed += item.amount;
      } else {
        personalMonthlyFixed += item.amount;
      }
      if (item.category === SPECIAL_CATEGORY.debtRepayment) {
        debtMonthlyFixed += item.amount;
      }
    }
  }
  return {
    personalMonthlyFixed: round2(personalMonthlyFixed),
    businessMonthlyFixed: round2(businessMonthlyFixed),
    debtMonthlyFixed: round2(debtMonthlyFixed),
  };
}

export interface BuildExpensesSheetInput {
  monthlyOutgoings: ExpensesSection[];
  annualOutgoings: ExpensesSection[];
  incomeMonthlyItems: ExpensesLineItem[];
  incomeAnnualItems: ExpensesLineItem[];
  monthsCovered: number;
  periodDescription: string;
}

/**
 * Build full sheet response from pipeline-derived sections (no exclusions).
 */
export function buildExpensesSheetResponse(input: BuildExpensesSheetInput): ExpensesSheetResponse {
  return applySimulationExclusionsInternal(input, new Set());
}

/**
 * Apply simulation exclusions: all rows stay; subtotals, insight, and summary reflect only included lines.
 */
export function applySimulationExclusions(
  baseline: ExpensesSheetResponse,
  excludedLineKeys: ReadonlySet<string>,
): ExpensesSheetResponse {
  if (excludedLineKeys.size === 0) {
    return {
      ...baseline,
      excludedLineKeys: [],
    };
  }
  return applySimulationExclusionsInternal(
    {
      monthlyOutgoings: baseline.monthlyOutgoings,
      annualOutgoings: baseline.annualOutgoings,
      incomeMonthlyItems: baseline.incomeMonthly.items,
      incomeAnnualItems: baseline.incomeAnnual.items,
      monthsCovered: baseline.summary.monthsCovered,
      periodDescription: baseline.summary.periodDescription,
    },
    excludedLineKeys,
  );
}

function applySimulationExclusionsInternal(
  input: BuildExpensesSheetInput,
  excluded: ReadonlySet<string>,
): ExpensesSheetResponse {
  const monthlyOutgoings = input.monthlyOutgoings.map((sec) => ({
    ...sec,
    subtotal: sectionSubtotal(sec, excluded),
    items: sec.items,
  }));

  const annualOutgoings = input.annualOutgoings.map((sec) => ({
    ...sec,
    subtotal: sectionSubtotal(sec, excluded),
    items: sec.items,
  }));

  const totalMonthlyOutgoings = round2(monthlyOutgoings.reduce((s, sec) => s + sec.subtotal, 0));
  const totalAnnualOutgoings = round2(annualOutgoings.reduce((s, sec) => s + sec.subtotal, 0));
  const totalMonthlyIncome = incomeTotal(input.incomeMonthlyItems, excluded);
  const totalAnnualIncome = incomeTotal(input.incomeAnnualItems, excluded);

  const { personalMonthlyFixed, businessMonthlyFixed, debtMonthlyFixed } = computeMonthlyOutgoingSplits(
    monthlyOutgoings,
    excluded,
  );

  const netMonthlyFixed = round2(totalMonthlyIncome - totalMonthlyOutgoings);
  const needToEarnMonthly = round2(Math.max(0, totalMonthlyOutgoings - totalMonthlyIncome));
  const monthlySurplus = round2(Math.max(0, totalMonthlyIncome - totalMonthlyOutgoings));
  const netAnnualFixed = round2(totalAnnualIncome - totalAnnualOutgoings);

  const excludedOpt = excluded.size > 0 ? excluded : undefined;

  const insight = buildExpensesInsight(
    monthlyOutgoings,
    input.incomeMonthlyItems,
    totalMonthlyOutgoings,
    totalMonthlyIncome,
    personalMonthlyFixed,
    businessMonthlyFixed,
    excludedOpt,
  );

  const yearlyFigures = computeYearlyFixedInsightFigures(
    insight,
    totalAnnualOutgoings,
    input.incomeAnnualItems,
    excludedOpt,
  );

  return {
    monthlyOutgoings,
    annualOutgoings,
    incomeMonthly: { items: input.incomeMonthlyItems, total: totalMonthlyIncome },
    incomeAnnual: { items: input.incomeAnnualItems, total: totalAnnualIncome },
    insight,
    summary: {
      totalMonthlyOutgoings,
      totalAnnualOutgoings,
      totalMonthlyIncome,
      totalAnnualIncome,
      netMonthlyFixed,
      needToEarnMonthly,
      monthlySurplus,
      personalMonthlyFixed,
      businessMonthlyFixed,
      debtMonthlyFixed,
      netAnnualFixed,
      totalYearlyFixedOutgoings: yearlyFigures.totalYearlyFixedOutgoings,
      totalYearlyPassiveIncome: yearlyFigures.totalYearlyPassiveIncome,
      yearlyIncomeNeededAfterPassive: yearlyFigures.yearlyIncomeNeededAfterPassive,
      periodDescription: input.periodDescription,
      monthsCovered: input.monthsCovered,
    },
    excludedLineKeys: Array.from(excluded).sort(),
  };
}
