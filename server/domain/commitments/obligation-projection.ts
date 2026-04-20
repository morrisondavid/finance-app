/**
 * Project `DeclaredOutgoing` commitments of the obligations-appropriate
 * categories into the legacy financial_obligations row shape. Isolating the
 * projection here keeps the repository layer free of schema branching.
 */

import type {
  DeclaredCommitment,
  DeclaredOutgoing,
  DeclaredOutgoingCategory,
} from '../../../shared/api-contracts.js';
import type { ObligationStateRow } from './obligation-state.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import { round2 } from '../../utils/math.js';

/** Categories that project to manual obligation rows. */
export const OBLIGATION_PROJECTED_CATEGORIES: readonly DeclaredOutgoingCategory[] = [
  'insurance',
  'subscription',
  'tax-manual',
] as const;

export function commitmentProjectsToObligation(c: DeclaredCommitment): c is
  Extract<DeclaredOutgoing, { category: 'insurance' | 'subscription' | 'tax-manual' }> {
  return OBLIGATION_PROJECTED_CATEGORIES.includes(c.category as DeclaredOutgoingCategory);
}

/**
 * Map a commitment's declared category to the `ObligationType` string used by
 * the existing obligations API + DB column. `tax-manual` carries its specific
 * subtype on `taxType` (vat / corporation-tax / self-assessment / hmrc-ttp)
 * so the projection is lossless. Older rows without `taxType` fall back to
 * 'self-assessment' — the only manual tax category the app originally
 * surfaced.
 */
export function obligationTypeForCommitment(
  c: Extract<DeclaredOutgoing, { category: 'insurance' | 'subscription' | 'tax-manual' }>,
): string {
  switch (c.category) {
    case 'insurance': return 'insurance';
    case 'subscription': return 'subscription';
    case 'tax-manual': return c.taxType ?? 'self-assessment';
  }
}

export interface ProjectedObligationRow {
  id: string;
  source: 'manual';
  type: string;
  name: string;
  entity: string;
  recurrence: string;
  expectedAmount: number | null;
  dueDate: string | null;
  status: string;
  paidAmount: number | null;
  paidDate: string | null;
  paidFromAccount: string | null;
  notes: string | null;
  personId: string | null;
}

/**
 * Turn a commitment + optional state override into the flat row shape the
 * obligations repository writes into `financial_obligations`. Native-currency
 * amounts are converted to GBP for `expectedAmount` so the existing UI
 * keeps working; native fields will be surfaced separately in the
 * `currency_everywhere` pass.
 */
export function projectCommitmentToObligationRow(
  c: Extract<DeclaredOutgoing, { category: 'insurance' | 'subscription' | 'tax-manual' }>,
  state: ObligationStateRow | undefined,
): ProjectedObligationRow {
  const gbpAmount = c.currency === 'GBP'
    ? c.amount
    : round2(convertAmountSync(c.amount, c.currency, 'GBP'));

  const dueDate = c.category === 'insurance' || c.category === 'tax-manual'
    ? c.dueDate ?? null
    : null;

  const personId = c.category === 'tax-manual' ? c.personId ?? null : null;

  return {
    id: c.id,
    source: 'manual',
    type: obligationTypeForCommitment(c),
    name: c.displayName ?? c.merchant,
    entity: c.merchant,
    recurrence: c.cadence,
    expectedAmount: gbpAmount,
    dueDate,
    status: state?.status ?? 'pending',
    paidAmount: state?.paidAmount ?? null,
    paidDate: state?.paidDate ?? null,
    paidFromAccount: state?.paidFromAccount ?? null,
    notes: c.notes ?? null,
    personId,
  };
}
