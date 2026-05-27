/**
 * Deploy verification: package + deterministic `sourceSha256` fingerprint.
 */

import express, { Request, Response } from 'express';
import { sendJsonRead } from '../http/read/send-json-read.js';
import { readApiVersion } from '../http/read/version-read.js';

const router = express.Router();

router.get('/', (_req: Request, res: Response) => {
  sendJsonRead(res, readApiVersion());
});

export default router;
