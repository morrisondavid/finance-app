/**
 * Clients HTTP surface.
 *
 * `GET /api/clients` returns the full list from the canonical
 * `server/domain/clients` registry. The frontend Contracts + Clients
 * tabs both read this. The Contracts tab joins it against the
 * contracts feed to show human-friendly names (`Delta Capita`,
 * `Edwin Group (via La Fosse)`) in place of the machine id
 * (`dc-sow-2026`); the Clients tab renders the full per-row detail
 * plus a kind-aware edit form.
 *
 * `PUT /api/clients/:id` patches a single row via the domain
 * `updateClient` helper, which owns the merge → validate → write →
 * invalidate chain. The route is a thin translator — every rejection
 * variant of `UpdateClientResult` maps onto a distinct HTTP status so
 * the UI can distinguish "unknown id" from "invalid input" from the
 * deliberate "kind flip rejected" without parsing error strings.
 */

import { Router, type Request, type Response } from 'express';
import {
  allClients,
  updateClient,
  type UpdateClientResult,
} from '../domain/clients/index.js';
import { ClientUpdateSchema } from '../../shared/api-contracts.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({ clients: allClients() });
});

router.put('/:id', (req: Request<{ id: string }>, res: Response) => {
  const parsed = ClientUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'Invalid request', details: parsed.error.issues });
    return;
  }

  const result: UpdateClientResult = updateClient({
    clientId: req.params.id,
    patch: parsed.data,
  });

  if (result.ok) {
    res.json({ client: result.client });
    return;
  }

  switch (result.code) {
    case 'not-found':
      res.status(404).json({ error: 'Client not found' });
      return;
    case 'kind-mismatch':
      res.status(400).json({
        error: 'kind-mismatch',
        detail: `Cannot change client kind from ${result.existingKind} to ${result.patchKind}; this would invalidate pinned contracts and template overrides.`,
      });
      return;
    case 'invalid':
      res
        .status(400)
        .json({ error: 'Invalid request', details: result.issues });
      return;
    default: {
      // Exhaustiveness check — if a new UpdateClientResult variant is
      // added without a case here, the type error surfaces at compile
      // time rather than a silent 200.
      const exhaustive: never = result;
      void exhaustive;
      res.status(500).json({ error: 'Unhandled update result' });
      return;
    }
  }
});

export default router;
