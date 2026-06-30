import express, { Request, Response } from 'express';
import { sendJsonRead } from '../http/read/send-json-read.js';
import { readTaxOverview, readTaxVatPayments } from '../http/read/tax-read.js';

const router = express.Router();

interface VatPaymentsQuery {
  financialYear?: string;
}

router.get('/overview', (_req: Request, res: Response) => {
  sendJsonRead(res, readTaxOverview());
});

router.get('/vat-payments', (req: Request<object, object, object, VatPaymentsQuery>, res: Response) => {
  sendJsonRead(res, readTaxVatPayments(req.query as Record<string, string | undefined>));
});

export default router;
