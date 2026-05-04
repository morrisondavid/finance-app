/**
 * Cross-entity / cross-currency “move personal savings to cover business debt” (§1.9 phase 2).
 *
 * v1 returns structured primitives only; full FX + tax modelling is future work.
 */

export type CrossScopeTransferReasonCode =
  | 'cross_scope_transfer_not_evaluated'
  | 'same_currency_stub_only';

export interface CrossScopeTransferEvaluation {
  /** Whether an automated suggestion believes a transfer is worthwhile. */
  readonly worthwhile: boolean;
  readonly source_scope: string;
  readonly target_scope: string;
  readonly source_currency: string;
  readonly target_currency: string;
  /** Placeholder fee field for future wire/FX fees. */
  readonly estimated_transfer_fee: number;
  readonly reason_codes: readonly CrossScopeTransferReasonCode[];
}

/**
 * Deterministic placeholder: real rules land once household↔business buffers are modelled.
 */
export function evaluateCrossScopeTransferPlaceholder(input: {
  readonly sourceScope: string;
  readonly targetScope: string;
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
}): CrossScopeTransferEvaluation {
  const sameFx = input.sourceCurrency === input.targetCurrency;
  return {
    worthwhile: false,
    source_scope: input.sourceScope,
    target_scope: input.targetScope,
    source_currency: input.sourceCurrency,
    target_currency: input.targetCurrency,
    estimated_transfer_fee: 0,
    reason_codes: sameFx
      ? ['cross_scope_transfer_not_evaluated']
      : ['cross_scope_transfer_not_evaluated'],
  };
}
