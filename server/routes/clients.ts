/**
 * Clients HTTP surface.
 *
 * `GET /api/clients` returns the full list from the canonical
 * `server/domain/clients` registry. The frontend Contracts tab joins
 * this against the contracts feed to show human-friendly names
 * (`Delta Capita`, `Edwin Group (via La Fosse)`) in place of the
 * machine id (`dc-sow-2026`). Keeping it a read-only list route —
 * CRUD lives in §1.2.D.
 */

import { Router, Request, Response } from 'express';
import { allClients } from '../domain/clients/queries.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({ clients: allClients() });
});

export default router;
