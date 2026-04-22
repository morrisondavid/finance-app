import express, { Request, Response } from 'express';
import { getFinancialYearRange } from '../db/utils/financial-year.js';
import { HMRC_PATTERNS } from '../domain/payees/index.js';
import { businessPaymentAccounts } from '../domain/accounts/index.js';
import type { VATPaymentsResponse } from '../../shared/api-contracts.js';
import { findHmrcPayments } from '../db/repositories/tax.js';

const router = express.Router();

interface VatPaymentsQuery {
  financialYear?: string;
}

/**
 * GET /api/tax/vat-payments
 * 
 * Returns all VAT payments to HMRC from all business payment accounts.
 * This endpoint searches across multiple accounts and multiple payment patterns
 * (bank and credit card VAT payments have different descriptions).
 */
router.get('/vat-payments', (req: Request<object, VATPaymentsResponse, object, VatPaymentsQuery>, res: Response<VATPaymentsResponse | { error: string }>) => {
  try {
    const { financialYear } = req.query;

    const range = financialYear
      ? getFinancialYearRange(financialYear)
      : { startDate: '2000-01-01', endDate: '2099-12-31' };

    const payments = findHmrcPayments({
      patterns: HMRC_PATTERNS.VAT,
      accounts: [...businessPaymentAccounts()],
      startDate: range.startDate,
      endDate: range.endDate,
    });

    res.json({ payments });
  } catch (error) {
    console.error('Error fetching VAT payments:', error);
    res.status(500).json({ error: 'Failed to fetch VAT payments' });
  }
});

export default router;
