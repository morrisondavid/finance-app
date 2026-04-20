/**
 * Project `OutgoingObligation` entries of the obligations-appropriate
 * categories into the legacy financial_obligations row shape. Isolating the
 * projection here keeps the repository layer free of schema branching.
 */

import type {
  Obligation,
  OutgoingObligation,
} from '../../../shared/api-contracts.js';
import type { ObligationStateRow } from './obligation-state.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import { round2 } from '../../utils/math.js';
import { assertNever } from '../../utils/assert-never.js';

/**
 * Named routing filter for the Obligations tab / `financial_obligations`
 * table projection. Every outgoing category is enumerated so adding a
 * new category forces a routing decision at compile time (see ADR 0001
 * §5). See sibling `showOnFixedExpenses` in `recurring-pipeline.ts`.
 */
export function showOnObligationsTab(c: OutgoingObligation): boolean {
  switch (c.category) {
    case 'insurance': return true;
    case 'subscription': return true;
    case 'tax-manual': return true;
    case 'fixed-bill': return false;
    case 'payroll': return false;
    default: return assertNever(c);
  }
}

/**
 * Narrow `Obligation` (incoming-or-outgoing) to the outgoing subset that
 * projects to the obligations DB row. Exhaustive over the full
 * `Obligation` union so a new incoming or outgoing category forces a
 * routing decision at compile time.
 */
export function obligationProjectsToRow(c: Obligation): c is
  Extract<OutgoingObligation, { category: 'insurance' | 'subscription' | 'tax-manual' }> {
  switch (c.category) {
    case 'rental-income': return false;
    case 'fixed-bill': return false;
    case 'payroll': return false;
    case 'insurance': return true;
    case 'subscription': return true;
    case 'tax-manual': return true;
    default: return assertNever(c);
  }
}

/**
 * Map a obligation's declared category to the `ObligationType` string used by
 * the existing obligations API + DB column. `tax-manual` carries its specific
 * subtype on `taxType` (vat / corporation-tax / self-assessment / hmrc-ttp)
 * so the projection is lossless. Older rows without `taxType` fall back to
 * 'self-assessment' — the only manual tax category the app originally
 * surfaced.
 */
export function obligationTypeForRow(
  c: Extract<OutgoingObligation, { category: 'insurance' | 'subscription' | 'tax-manual' }>,
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
  frequency: string;
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
 * Turn a obligation + optional state override into the flat row shape the
 * obligations repository writes into `financial_obligations`. Native-currency
 * amounts are converted to GBP for `expectedAmount` so the existing UI
 * keeps working; native fields will be surfaced separately in the
 * `currency_everywhere` pass.
 */
export function projectObligationToRow(
  c: Extract<OutgoingObligation, { category: 'insurance' | 'subscription' | 'tax-manual' }>,
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
    type: obligationTypeForRow(c),
    name: c.displayName ?? c.merchant,
    entity: c.merchant,
    frequency: c.frequency,
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
