import type { VatQuarterRange } from '../config/tax-rates.js';
import type { HmrcPaymentMatch } from '../db/repositories/tax.js';
import { round2 } from './math.js';

export type VatReconciliationStatus = 'paid' | 'unpaid' | 'underpaid' | 'not-yet-due' | 'no-income' | 'insufficient-data';

export interface VatQuarterReconciliation {
  quarter: VatQuarterRange;
  expectedAmount: number;
  paidAmount: number;
  paidDate: string | null;
  paidFromAccount: string | null;
  status: VatReconciliationStatus;
}

/**
 * @param dataCutoffDate Quarters ending before this date are treated as having
 *   insufficient transaction coverage. Callers should set this to the start of
 *   the *previous* financial year so both the current and prior FY are trusted.
 */
export function reconcileVatQuarter(
  quarter: VatQuarterRange,
  quarterIncome: number,
  vatFraction: number,
  payments: HmrcPaymentMatch[],
  referenceDate: Date = new Date(),
  dataCutoffDate: string | null = null,
): VatQuarterReconciliation {
  const expectedAmount = round2(quarterIncome * vatFraction);

  if (quarterIncome <= 0) {
    return { quarter, expectedAmount: 0, paidAmount: 0, paidDate: null, paidFromAccount: null, status: 'no-income' };
  }

  const dueDate = new Date(`${quarter.dueDate}T23:59:59`);
  if (referenceDate < dueDate) {
    const paidAmount = round2(payments.reduce((s, p) => s + Math.abs(p.amount), 0));
    if (paidAmount >= expectedAmount * 0.95) {
      const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
      const accounts = [...new Set(payments.map(p => p.account))];
      return {
        quarter, expectedAmount, paidAmount,
        paidDate: sorted[sorted.length - 1]?.date ?? null,
        paidFromAccount: accounts.join(', ') || null,
        status: 'paid',
      };
    }
    return {
      quarter, expectedAmount, paidAmount,
      paidDate: payments.length > 0 ? [...payments].sort((a, b) => a.date.localeCompare(b.date)).pop()?.date ?? null : null,
      paidFromAccount: payments.length > 0 ? [...new Set(payments.map(p => p.account))].join(', ') : null,
      status: 'not-yet-due',
    };
  }

  if (payments.length === 0) {
    const isOutsideTrustedRange = dataCutoffDate !== null && quarter.endDate < dataCutoffDate;
    const status: VatReconciliationStatus = isOutsideTrustedRange ? 'insufficient-data' : 'unpaid';
    return { quarter, expectedAmount, paidAmount: 0, paidDate: null, paidFromAccount: null, status };
  }

  const paidAmount = round2(payments.reduce((s, p) => s + Math.abs(p.amount), 0));
  const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  const accounts = [...new Set(payments.map(p => p.account))];

  const status: VatReconciliationStatus = paidAmount >= expectedAmount * 0.95 ? 'paid' : 'underpaid';

  return {
    quarter, expectedAmount, paidAmount,
    paidDate: sorted[sorted.length - 1]?.date ?? null,
    paidFromAccount: accounts.join(', ') || null,
    status,
  };
}
