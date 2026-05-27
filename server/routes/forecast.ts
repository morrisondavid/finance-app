/**
 * /api/forecast — cash-flow projection endpoint (§1.5).
 *
 * Route map:
 *   GET /api/forecast?days=90&entityId=autonize-it-ltd
 *     — daily-resolution balance projection per account and entity.
 *       `days` defaults to 90; `entityId` is optional (omit for all).
 */

import { Router, type Request, type Response } from 'express';
import { sendJsonRead } from '../http/read/send-json-read.js';
import { readForecastFromQuery } from '../http/read/forecast-read.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  sendJsonRead(res, readForecastFromQuery(req.query as Record<string, unknown>));
});

export default router;
