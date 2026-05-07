import type {
  FinancialSafetyInput,
  FinancialSafetyPillarRow,
  FinancialSafetyResult,
  FinancialSafetyWarningInput,
} from './types.js';

const FORMULA_VERSION = '1.0.0' as const;

const W_CAP = 7;
const WEIGHT_A = 0.35;
const WEIGHT_B = 0.3;
const WEIGHT_C = 0.15;
const WEIGHT_D = 0.2;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function pillarLiquidityVsCommitments(input: FinancialSafetyInput): FinancialSafetyPillarRow {
  const { totalCashGbp, totalCommittedGbp, cashAfterCommitmentsGbp } = input;
  let contribution = 10;
  if (totalCommittedGbp > 0) {
    const r = cashAfterCommitmentsGbp / totalCommittedGbp;
    if (r >= 0.2) contribution = 10;
    else if (r >= 0) contribution = 5 + (r / 0.2) * 5;
    else if (r >= -0.2) contribution = 5 * (1 + r / 0.2);
    else contribution = 0;
  } else if (totalCashGbp <= 0) {
    contribution = 0;
  }
  contribution = round1(clamp01(contribution / 10) * 10);
  return {
    id: 'A',
    label: 'Liquidity vs commitments',
    contribution,
    weight: WEIGHT_A,
    rawMetrics: {
      totalCashGbp,
      totalCommittedGbp,
      cashAfterCommitmentsGbp,
      coverageVsCommitted: totalCommittedGbp > 0 ? cashAfterCommitmentsGbp / totalCommittedGbp : null,
    },
  };
}

function pillarRunway(input: FinancialSafetyInput): FinancialSafetyPillarRow {
  const months = input.runwayMonthsFullRecurring;
  let runwayScore = 10;
  if (months !== null) {
    if (months >= 12) runwayScore = 10;
    else if (months >= 6) runwayScore = 8;
    else if (months >= 3) runwayScore = 6;
    else if (months >= 1) runwayScore = 4;
    else runwayScore = 2;
  }
  if (input.verdictKind === 'negative_after_commitments') runwayScore = Math.min(runwayScore, 2);
  if (input.verdictKind === 'deficit_imminent') runwayScore = Math.min(runwayScore, 3);
  if (input.verdictKind === 'runway_stressed') runwayScore = Math.min(runwayScore, 6);
  runwayScore = round1(runwayScore);
  return {
    id: 'B',
    label: 'Runway / stress',
    contribution: runwayScore,
    weight: WEIGHT_B,
    rawMetrics: {
      runwayMonthsFullRecurring: months,
      verdictKind: input.verdictKind,
    },
  };
}

function pillarIncomeDurability(input: FinancialSafetyInput): FinancialSafetyPillarRow {
  const share = input.topClientShareOfActiveMonthly;
  let contribution: number;
  if (share === null) {
    contribution = 6.5;
  } else {
    const over = clamp01(share / 0.75);
    contribution = round1(10 * (1 - over));
  }
  const inv = input.outstandingInvoicesGbp;
  if (inv > 250_000) contribution = round1(Math.max(0, contribution - 1));
  else if (inv > 80_000) contribution = round1(Math.max(0, contribution - 0.5));
  return {
    id: 'C',
    label: 'Income durability',
    contribution,
    weight: WEIGHT_C,
    rawMetrics: {
      topClientShareOfActiveMonthly: share,
      outstandingInvoicesGbp: inv,
    },
  };
}

function pillarExpenseDebt(input: FinancialSafetyInput): FinancialSafetyPillarRow {
  const n = input.budgetNudgeCount;
  const nudgePart = round1(Math.max(0, 10 - Math.min(5, n * 0.75)));
  const ratio = input.debtMinAvailableHeadroomRatio;
  const debtPart = ratio === null ? 10 : round1(10 * clamp01(ratio));
  const contribution = round1(nudgePart * 0.45 + debtPart * 0.55);
  return {
    id: 'D',
    label: 'Expense & debt headroom',
    contribution,
    weight: WEIGHT_D,
    rawMetrics: {
      budgetNudgeCount: n,
      debtMinAvailableHeadroomRatio: ratio,
    },
  };
}

function warningModifier(warnings: readonly FinancialSafetyWarningInput[]): {
  pointsDeducted: number;
  linkedWarnings: FinancialSafetyResult['warningAdjustment']['linkedWarnings'];
  capApplied: number | null;
} {
  let raw = 0;
  const linkedWarnings = warnings.map(w => ({ id: w.id, code: w.code }));
  for (const w of warnings) {
    if (w.severity === 'critical') raw += 2;
    else if (w.severity === 'warn') raw += 1;
    else raw += 0.35;
  }
  const capped = Math.min(W_CAP, raw);
  return {
    pointsDeducted: round1(capped),
    linkedWarnings,
    capApplied: round1(raw) > W_CAP ? W_CAP : null,
  };
}

/**
 * Versioned §2.2 headline score and explainability rows. Deterministic given `FinancialSafetyInput`.
 */
export function computeFinancialSafety(input: FinancialSafetyInput): FinancialSafetyResult {
  const a = pillarLiquidityVsCommitments(input);
  const b = pillarRunway(input);
  const c = pillarIncomeDurability(input);
  const d = pillarExpenseDebt(input);
  const pillars = [a, b, c, d] as const;

  const baseScoreBeforeWarnings = round1(
    a.contribution * a.weight +
      b.contribution * b.weight +
      c.contribution * c.weight +
      d.contribution * d.weight,
  );

  const mod = warningModifier(input.warnings);
  const score = round1(
    Math.min(10, Math.max(0, baseScoreBeforeWarnings - mod.pointsDeducted)),
  );

  return {
    score,
    formulaVersion: FORMULA_VERSION,
    pillars,
    warningAdjustment: {
      pointsDeducted: mod.pointsDeducted,
      linkedWarnings: mod.linkedWarnings,
      capApplied: mod.capApplied,
    },
    baseScoreBeforeWarnings,
  };
}
