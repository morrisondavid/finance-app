/**
 * Canonical `PUT /api/clients/:id` mutation — Express + MCP (`clients_update`).
 */

import { ClientUpdateSchema } from '../../../shared/api-contracts.js';
import { updateClient } from '../../domain/clients/index.js';
import type { JsonMutationResult } from './types.js';

export function mutateClientsUpdate(clientId: string, body: unknown): JsonMutationResult {
  const parsed = ClientUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
  }

  const result = updateClient({
    clientId,
    patch: parsed.data,
  });

  if (result.ok) {
    return { status: 200, body: { client: result.client } };
  }

  switch (result.code) {
    case 'not-found':
      return { status: 404, body: { error: 'Client not found' } };
    case 'kind-mismatch':
      return {
        status: 400,
        body: {
          error: 'kind-mismatch',
          detail: `Cannot change client kind from ${result.existingKind} to ${result.patchKind}; this would invalidate pinned contracts and template overrides.`,
        },
      };
    case 'invalid':
      return { status: 400, body: { error: 'Invalid request', details: result.issues } };
    default: {
      const exhaustive: never = result;
      void exhaustive;
      return { status: 500, body: { error: 'Unhandled update result' } };
    }
  }
}
