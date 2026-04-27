/**
 * `plan-budget-blown` warnings (§1.9).
 *
 * Active plan-scoped budget overruns. When a category's
 * month-to-date spend exceeds its budget cap AND there are active
 * plans depending on that headroom, the plan's projection is at
 * risk — emit this warning. Severity scales with how early in the
 * month the cap is blown:
 *
 *   - Day 1-7 (1st week)  → critical (entire month at risk)
 *   - Day 8-14            → warn
 *   - Day 15-21           → warn
 *   - Day 22+             → info (most of the month is over anyway)
 *
 * Pure: caller supplies the month-to-date totals + budgets.
 */

import type {
  EntityFoundationWarning,
  WarningSeverity,
} from '../../../shared/api-contracts.js';

export interface BudgetBlownInput {
  /** Today's date. Used to compute "day of month" for severity scaling. */
  readonly today: string;
  /**
   * Month-to-date spend per category in the same currency the budget
   * is set in. Caller filters to the active plan's currency+scope.
   */
  readonly monthToDateSpend: ReadonlyMap<string, number>;
  /** Budget cap per category. */
  readonly budgetByCategory: ReadonlyMap<string, number>;
  /** True when there's at least one active plan that depends on these budgets holding. */
  readonly hasActivePlans: boolean;
}

function dayOfMonth(iso: string): number {
  const d = Number(iso.slice(8, 10));
  return Number.isFinite(d) ? d : 1;
}

function severityForDay(day: number): WarningSeverity {
  if (day <= 7) return 'critical';
  if (day <= 21) return 'warn';
  return 'info';
}

export function derivePlanBudgetBlownWarnings(
  input: BudgetBlownInput,
): EntityFoundationWarning[] {
  if (!input.hasActivePlans) return [];
  const day = dayOfMonth(input.today);
  const severity = severityForDay(day);
  const out: EntityFoundationWarning[] = [];
  for (const [category, cap] of input.budgetByCategory) {
    const spent = input.monthToDateSpend.get(category) ?? 0;
    if (spent <= cap) continue;
    const overage = Math.round((spent - cap) * 100) / 100;
    out.push({
      id: `plan-budget-blown:${category}`,
      code: 'plan-budget-blown',
      severity,
      title: `${category} budget blown — over by £${overage} this month`,
      detail:
        `Month-to-date ${category} spend is £${Math.round(spent * 100) / 100} against a cap of £${cap} ` +
        `(over by £${overage}). With at least one active §1.9 plan depending on the headroom this ` +
        `cap was supposed to free, the plan's projected clear date may slip.`,
      recommended_action:
        day <= 7
          ? `It's still early in the month — pull back hard on ${category} spending or ` +
            `re-evaluate the plan's intensity.`
          : `Roll the overage into next month's mental budget; the plan stays on track if ` +
            `subsequent months stay below cap.`,
      sources: [`category:${category}`, 'plan-budget-blown'],
      context: {
        category,
        monthToDateSpend: Math.round(spent * 100) / 100,
        cap,
        overageGbp: overage,
        dayOfMonth: day,
      },
    });
  }
  return out;
}
