/**
 * Deploy verification: package + deterministic `sourceSha256` fingerprint.
 */

import express, { Request, Response } from 'express';
import { ApiVersionResponseSchema } from '../../shared/api-contracts.js';
import { buildApiVersionPayload } from '../runtime-version.js';

const router = express.Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(ApiVersionResponseSchema.parse(buildApiVersionPayload()));
});

export default router;
