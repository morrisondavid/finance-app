/**
 * `plan-feasibility-degraded` and `plan-infeasible` warnings (§1.9).
 *
 * Surfaces the §1.9 `checkPlanFeasibility` outputs onto the §1.8
 * warnings spine. `degraded` → `plan-feasibility-degraded` (warn);
 * `infeasible` → `plan-infeasible` (critical). Suggested remedies are
 * carried as primitives so the consumer can render actionable next-
 * steps without re-deriving the math.
 *
 * Pure: caller passes the feasibility reports keyed by plan id (the
 * orchestrator already computes these).
 */

import type {
  EntityFoundationWarning,
} from '../../../shared/api-contracts.js';
import type { Plan } from '../debt-strategy/schema.js';
import type { FeasibilityReport, SuggestedRemedy } from '../debt-strategy/check-plan-feasibility.js';

export interface PlanWithFeasibilityReport {
  readonly plan: Plan;
  readonly report: FeasibilityReport;
}

export interface DerivePlanFeasibilityDegradedInput {
  readonly reports: readonly PlanWithFeasibilityReport[];
}

function flattenRemedies(remedies: readonly SuggestedRemedy[]): {
  remedyKinds: string;
  pauseSuggestionsCsv: string;
  switchToIntensity: string | null;
  freesMonthlyTotal: number;
} {
  const kinds = remedies.map(r => r.kind);
  const pauses = remedies
    .filter(r => r.kind === 'pause-other-plan')
    .map(r => `${r.otherPlanDisplayName ?? r.otherPlanId}@£${r.freesMonthly}`);
  const switchTo = remedies.find(r => r.kind === 'switch-intensity')?.newIntensity ?? null;
  const freesTotal = remedies.reduce((sum, r) => sum + r.freesMonthly, 0);
  return {
    remedyKinds: kinds.join(','),
    pauseSuggestionsCsv: pauses.join(';'),
    switchToIntensity: switchTo,
    freesMonthlyTotal: Math.round(freesTotal * 100) / 100,
  };
}

export function derivePlanFeasibilityDegradedWarnings(
  input: DerivePlanFeasibilityDegradedInput,
): EntityFoundationWarning[] {
  const out: EntityFoundationWarning[] = [];
  for (const { plan, report } of input.reports) {
    if (report.status === 'ok') continue;
    const remedies = flattenRemedies(report.suggestedRemedies);
    const code = report.status === 'infeasible' ? 'plan-infeasible' : 'plan-feasibility-degraded';
    const severity = report.status === 'infeasible' ? 'critical' : 'warn';
    out.push({
      id: `${code}:${plan.id}`,
      code,
      severity,
      title:
        report.status === 'infeasible'
          ? `'${plan.display_name}' can no longer fit in your headroom`
          : `'${plan.display_name}' headroom margin shrinking`,
      detail:
        `Required £${report.requiredAllocation}/mo, currently £${report.currentAvailable}/mo available ` +
        `(gap £${report.gap}/mo). ${
          remedies.pauseSuggestionsCsv
            ? `Pausing one of [${remedies.pauseSuggestionsCsv}] would free up the headroom.`
            : ''
        } ${
          remedies.switchToIntensity
            ? `Switching to '${remedies.switchToIntensity}' intensity would also fit.`
            : ''
        }`.trim(),
      recommended_action:
        report.status === 'infeasible'
          ? `Pause/deactivate another plan, switch this plan to a less-intense intensity, or extend the deadline.`
          : `Review your headroom — a small change (one budget cut or pausing a smaller plan) keeps this plan on track.`,
      sources: [`plan:${plan.id}`, code],
      context: {
        planId: plan.id,
        planDisplayName: plan.display_name,
        feasibilityStatus: report.status,
        gapGbp: report.gap,
        requiredAllocation: report.requiredAllocation,
        currentAvailable: report.currentAvailable,
        ...remedies,
      },
    });
  }
  return out;
}
