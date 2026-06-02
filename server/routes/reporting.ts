import { Router, type Request, type Response } from 'express';
import { readReportingReadiness } from '../http/read/reporting-read.js';
import { sendJsonRead } from '../http/read/send-json-read.js';

const router = Router();

router.get('/readiness', (req: Request, res: Response) => {
  sendJsonRead(res, readReportingReadiness(req.query));
});

export default router;
