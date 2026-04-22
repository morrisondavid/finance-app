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
import { CompaniesListResponseSchema } from '../../shared/api-contracts.js';
import { getCompanyRegistry } from '../domain/company/registry.js';

const router = express.Router();

router.get('/', (_req: Request, res: Response) => {
  try {
    const registry = getCompanyRegistry();
    const body = CompaniesListResponseSchema.parse({ companies: registry.all });
    res.json(body);
  } catch (error) {
    console.error('[Company] GET error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to list companies: ${message}` });
  }
});

export default router;
