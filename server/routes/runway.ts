/**
 * GET /api/runway — worst-case household stress (no new contract income) with
 * GBP + AED holistic headlines and entity drill-down in `stress` blocks.
 */

import { Router, type Request, type Response } from 'express';
import { sendJsonRead } from '../http/read/send-json-read.js';
import { readHouseholdRunwayFromQuery } from '../http/read/runway-read.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  sendJsonRead(res, readHouseholdRunwayFromQuery(req.query as Record<string, unknown>));
});

export default router;
