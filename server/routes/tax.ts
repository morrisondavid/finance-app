import express, { Request, Response } from 'express';
import { getDb } from '../db/connection.js';
import { buildFYWhereClause } from '../db/utils/financial-year.js';
import { HMRC_PATTERNS } from '../config/payees.js';
import { getBusinessPaymentAccounts } from '../types.js';
import type { VATPaymentsResponse } from '../../shared/api-contracts.js';

const router = express.Router();

interface VatPaymentsQuery {
  financialYear?: string;
}

interface VatPaymentRow {
  id: number;
  date: string;
  description: string;
  amount: number;
  account: string;
  type: string;
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
    const db = getDb();
    
    // Get all business accounts that can make payments
    const accounts = getBusinessPaymentAccounts();
    
    // Build pattern conditions from HMRC_PATTERNS.VAT array
    const patterns = HMRC_PATTERNS.VAT; // ['HMRC VAT%', 'HMRC ETMP%']
    const patternCondition = patterns.map(() => 'description LIKE ?').join(' OR ');
    
    // Build account placeholders
    const accountPlaceholders = accounts.map(() => '?').join(',');
    
    // Build financial year condition
    const { clause: financialYearClause, params: financialYearParams } = buildFYWhereClause(financialYear);
    
    // Query all VAT payments from business accounts
    const payments = db.prepare(`
      SELECT id, date, description, amount, account, type
      FROM transactions
      WHERE type = 'expense'
      AND (${patternCondition})
      AND account IN (${accountPlaceholders})
      ${financialYearClause}
      ORDER BY date DESC
    `).all(...patterns, ...accounts, ...financialYearParams) as VatPaymentRow[];
    
    res.json({ payments: payments as VATPaymentsResponse['payments'] });
  } catch (error) {
    console.error('Error fetching VAT payments:', error);
    res.status(500).json({ error: 'Failed to fetch VAT payments' });
  }
});

export default router;
