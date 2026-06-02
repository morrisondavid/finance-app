/**
 * §2.1 task-shaped verdict from liquidity + runway + near-term window.
 */

import type { AiFinancialSnapshotVerdict, RunwayHolisticGbp } from '../../../shared/api-contracts.js';
import { daysBetween } from '../../../shared/iso-date.js';

export interface DeriveFinancialVerdictInput {
  readonly today: string;
  readonly cashAfter12MonthCommitmentsGbp: number;
  /**
   * Money already earned but not yet banked (unpaid invoices + worked-but-not-
   * invoiced, retained). Counted alongside cash when testing whether 12-month
   * commitments are covered. `0` disables the credit. Never projected work.
   */
  readonly earnedReceivablesGbp: number;
  readonly holisticGbp: RunwayHolisticGbp;
  /** Inclusive end of the near-term commitment window (obligation pipeline slice). */
  readonly commitmentWindowEndDate: string;
}

export function deriveFinancialVerdict(input: DeriveFinancialVerdictInput): AiFinancialSnapshotVerdict {
  const {
    today,
    cashAfter12MonthCommitmentsGbp,
    earnedReceivablesGbp,
    holisticGbp,
    commitmentWindowEndDate,
  } = input;

  const resourcesAfterCommitmentsGbp = cashAfter12MonthCommitmentsGbp + earnedReceivablesGbp;

  if (resourcesAfterCommitmentsGbp < 0) {
    return {
      kind: 'negative_after_commitments',
      reasons: [
        `Cash after rolling 12-month commitments is ${cashAfter12MonthCommitmentsGbp.toFixed(2)} GBP; ` +
          `even counting ${earnedReceivablesGbp.toFixed(2)} GBP of earned-but-unpaid income you are ` +
          `still short by ${Math.abs(resourcesAfterCommitmentsGbp).toFixed(2)} GBP.`,
      ],
      cashAfter12MonthCommitmentsGbp,
      resourcesAfterCommitmentsGbp,
    };
  }

  const stress = holisticGbp.firstStressDateFullRecurring;
  if (stress === null) {
    return {
      kind: 'safe',
      reasons: ['No holistic GBP cash stress date within the forecast horizon.'],
    };
  }

  const deficitInDays = daysBetween(stress, today);

  if (stress <= commitmentWindowEndDate) {
    return {
      kind: 'deficit_imminent',
      reasons: [
        `Holistic GBP cash is projected to go negative on ${stress} (within the near-term commitment window).`,
      ],
      firstStressDateFullRecurring: stress,
      runwayMonthsFullRecurring: holisticGbp.runwayMonthsFullRecurring,
      deficitInDays,
    };
  }

  return {
    kind: 'runway_stressed',
    reasons: [
      `Holistic GBP cash is projected to go negative on ${stress} (after the near-term commitment window ends ${commitmentWindowEndDate}).`,
    ],
    firstStressDateFullRecurring: stress,
    runwayMonthsFullRecurring: holisticGbp.runwayMonthsFullRecurring,
    deficitInDays,
  };
}
