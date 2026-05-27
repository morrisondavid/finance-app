/**
 * Public holidays endpoint — returns entity-scoped public holidays
 * for a date window.
 */

import { Router } from 'express';
import { sendJsonRead } from '../http/read/send-json-read.js';
import { readPublicHolidaysFromQuery } from '../http/read/public-holidays-read.js';

const router = Router();

router.get('/', (req, res) => {
  sendJsonRead(res, readPublicHolidaysFromQuery(req.query as Record<string, unknown>));
});

export default router;
