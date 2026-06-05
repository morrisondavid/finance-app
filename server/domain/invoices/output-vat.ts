/**
 * Invoice-based output VAT for UK auto obligations (accrual / standard scheme).
 *
 * Pure helpers: no DB, no registry I/O. Callers supply invoices loaded
 * from the registry.
 */

import type { EntityId, Invoice, UkCompany } from '../../../shared/api-contracts.js';
import type { VatQuarterRange } from '../../config/tax-rates.js';
import { vatObligationAmounts } from '../../config/tax-rates.js';
import { round2 } from '../../utils/math.js';

export interface SumInvoiceOutputVatForQuarterInput {
  readonly entityId: EntityId;
  readonly startDate: string;
  readonly endDate: string;
  readonly invoices: readonly Invoice[];
}

/**
 * Sum `vat_amount` for non-draft invoices whose tax point (`invoice_date`)
 * falls in `[startDate, endDate]` for the given issuing entity.
 */
export function sumInvoiceOutputVatForQuarter(
  input: SumInvoiceOutputVatForQuarterInput,
): number {
  let total = 0;
  for (const inv of input.invoices) {
    if (inv.issuing_entity_id !== input.entityId) continue;
    if (inv.status === 'draft') continue;
    if (inv.invoice_date < input.startDate || inv.invoice_date > input.endDate) continue;
    total += inv.vat_amount;
  }
  return round2(total);
}

export interface ResolveVatObligationAmountsInput {
  readonly quarter: VatQuarterRange;
  readonly quarterIncomeGross: number;
  readonly entityId: EntityId;
  readonly vatScheme: 'standard' | 'cash';
  readonly invoices: readonly Invoice[];
  readonly company: UkCompany | null;
}

export interface ResolvedVatObligationAmounts {
  readonly expectedAmount: number;
  readonly naiveAmount: number | null;
  readonly adjustmentBasis: string | null;
  readonly adjustmentSource: string | null;
}

const INVOICE_ACCRUAL_BASIS = 'invoice output VAT (accrual basis)';
const INVOICE_ACCRUAL_SOURCE = 'invoices';

/**
 * Resolve obligation row amounts for one VAT quarter.
 *
 * `standard` — `expectedAmount` from issued invoices; `naiveAmount` retains
 * the bank-income × VAT fraction proxy for comparison.
 * `cash` — both amounts from the legacy bank proxy (unchanged behaviour).
 */
export function resolveVatObligationAmounts(
  input: ResolveVatObligationAmountsInput,
): ResolvedVatObligationAmounts {
  const bankAmounts = vatObligationAmounts(input.quarterIncomeGross, input.company);
  const bankExpected = bankAmounts?.expectedAmount
    ?? round2(Math.max(0, input.quarterIncomeGross) * (1 / 6));

  if (input.vatScheme === 'cash') {
    return {
      expectedAmount: bankExpected,
      naiveAmount: bankAmounts?.naiveAmount ?? null,
      adjustmentBasis: bankAmounts?.adjustmentBasis ?? null,
      adjustmentSource: bankAmounts?.adjustmentSource ?? null,
    };
  }

  const invoiceVat = sumInvoiceOutputVatForQuarter({
    entityId: input.entityId,
    startDate: input.quarter.startDate,
    endDate: input.quarter.endDate,
    invoices: input.invoices,
  });

  return {
    expectedAmount: invoiceVat,
    naiveAmount: bankAmounts?.naiveAmount ?? round2(Math.max(0, input.quarterIncomeGross) * (1 / 6)),
    adjustmentBasis: INVOICE_ACCRUAL_BASIS,
    adjustmentSource: INVOICE_ACCRUAL_SOURCE,
  };
}
