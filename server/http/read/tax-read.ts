import { getFinancialYearRange } from '../../db/utils/financial-year.js';
import { HMRC_PATTERNS } from '../../domain/payees/index.js';
import { businessPaymentAccounts } from '../../domain/accounts/index.js';
import { findHmrcPayments } from '../../db/repositories/tax.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

export function readTaxVatPayments(query: Record<string, string | undefined>): JsonReadResult {
  try {
    const financialYearRaw = query.financialYear;
    const range = financialYearRaw
      ? getFinancialYearRange(financialYearRaw)
      : { startDate: '2000-01-01', endDate: '2099-12-31' };

    const payments = findHmrcPayments({
      patterns: HMRC_PATTERNS.VAT,
      accounts: [...businessPaymentAccounts()],
      startDate: range.startDate,
      endDate: range.endDate,
    });

    return jsonReadOk({ payments });
  } catch {
    console.error('Error fetching VAT payments');
    return jsonReadFail(500, { error: 'Failed to fetch VAT payments' });
  }
}
