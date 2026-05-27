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
import { sendJsonRead } from '../http/read/send-json-read.js';
import { readClientsList } from '../http/read/clients-read.js';
import { sendJsonMutation } from '../http/mutation/send-json-mutation.js';
import { mutateClientsUpdate } from '../http/mutation/clients-update.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  sendJsonRead(res, readClientsList());
});

router.put('/:id', (req: Request<{ id: string }>, res: Response) => {
  sendJsonMutation(res, mutateClientsUpdate(req.params.id, req.body));
});

export default router;
