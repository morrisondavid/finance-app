/**
 * Deploy verification: immutable build stamps from Docker `--build-arg` + package.json version.
 */

import express, { Request, Response } from 'express';
import { ApiVersionResponseSchema } from '../../shared/api-contracts.js';
import { buildApiVersionPayload } from '../runtime-version.js';

const router = express.Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(ApiVersionResponseSchema.parse(buildApiVersionPayload()));
});

export default router;
