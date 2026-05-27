/**
 * /api/company — read-only projection of the entity registry
 * (Roadmap 1.1).
 *
 * Route map:
 *   GET /api/company  — list every entity row from autonize-it/company.csv.
 *
 * Mutations (resolving TBC fields, adding new entities) happen via the
 * CSV file directly for this phase; a PATCH surface is deferred until a
 * future tier asks for it.
 */

import express, { Request, Response } from 'express';
import { sendJsonRead } from '../http/read/send-json-read.js';
import { readCompanyList } from '../http/read/company-read.js';

const router = express.Router();

router.get('/', (_req: Request, res: Response) => {
  sendJsonRead(res, readCompanyList());
});

export default router;
