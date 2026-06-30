/**
 * §2.2 Financial Safety — pure numeric inputs and outputs (shared: server + Vitest + frontend theme).
 */

export type FinancialSafetyWarningSeverity = 'critical' | 'warn' | 'info';

export interface FinancialSafetyWarningInput {
  readonly id: string;
  readonly code: string;
  readonly severity: FinancialSafetyWarningSeverity;
  /** §2.3 — matches `EntityFoundationWarning.fingerprint` when enriched. */
  readonly fingerprint?: string;
}

export type FinancialSafetyVerdictKind =
  | 'safe'
  | 'runway_stressed'
  | 'deficit_imminent'
  | 'negative_after_commitments';

/** Serializable DTO — server maps domain snapshots into this shape before calling `computeFinancialSafety`. */
export interface FinancialSafetyInput {
  /** Pillar A — cash vs 12‑month committed model. */
  readonly totalCashGbp: number;
  readonly totalCommittedGbp: number;
  readonly cashAfterCommitmentsGbp: number;
  /**
   * Pillar A — money already earned but not yet banked: unpaid issued invoices
   * (full) + worked-but-not-invoiced accrual (retained, after VAT/CT). Added to
   * the liquidity side so the score credits work already done. Never includes
   * projected future work. `0` when there are no earned receivables.
   */
  readonly earnedButNotCollectedGbp: number;
  /** Pillar B — holistic runway (months); null when not stressed in horizon. */
  readonly runwayMonthsFullRecurring: number | null;
  readonly verdictKind: FinancialSafetyVerdictKind;
  /** Pillar C — top-client share of active monthly (0–1); null when household GBP composition missing. */
  readonly topClientShareOfActiveMonthly: number | null;
  /** Outstanding invoices (GBP). */
  readonly outstandingInvoicesGbp: number;
  /** Pillar D — budget pressure. */
  readonly budgetNudgeCount: number;
  /**
   * Pillar D — min across debt-strategy buckets of `availableHeadroom / totalHeadroom` (0–1).
   * Null when no positive headroom buckets.
   */
  readonly debtMinAvailableHeadroomRatio: number | null;
  readonly warnings: readonly FinancialSafetyWarningInput[];
}

export interface FinancialSafetyPillarRow {
  readonly id: 'A' | 'B' | 'C' | 'D';
  readonly label: string;
  /** Sub-score 0–10 before weights. */
  readonly contribution: number;
  readonly weight: number;
  readonly rawMetrics: Readonly<Record<string, number | string | boolean | null>>;
}

export interface FinancialSafetyWarningAdjustment {
  readonly pointsDeducted: number;
  readonly linkedWarnings: ReadonlyArray<{
    readonly id: string;
    readonly code: string;
    readonly fingerprint?: string;
  }>;
  /** When the aggregate penalty hits the cap (pointsDeducted equals cap). */
  readonly capApplied: number | null;
}

export interface FinancialSafetyResult {
  readonly score: number;
  readonly formulaVersion: '1.0.0';
  readonly pillars: readonly FinancialSafetyPillarRow[];
  readonly warningAdjustment: FinancialSafetyWarningAdjustment;
  /** Pre-modifier blend of pillars (0–10). */
  readonly baseScoreBeforeWarnings: number;
}

export type SafetyHueBand = 'good' | 'medium' | 'poor';

export interface SafetyTheme {
  /** 0–1 position along green → amber → red. */
  readonly stress: number;
  readonly band: SafetyHueBand;
  /** For inline styles / CSS variables. */
  readonly css: Readonly<{
    '--fs-score-hue': string;
    '--fs-score-fg': string;
    '--fs-score-bg': string;
    '--fs-score-border': string;
  }>;
}
