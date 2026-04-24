/**
 * Clients domain — write surface.
 *
 * This is the only place that rewrites `clients/clients.csv`. The route
 * layer calls {@link updateClient}; anything else is using the wrong
 * seam. Keeping the seam narrow means the merge + validate + write +
 * invalidate sequence is authored once and regression-tested in
 * isolation from the HTTP layer.
 *
 * `queries.ts` stays pure (index reads only) — mutations live here so
 * the split is obvious from the filename.
 *
 * Result is a discriminated `UpdateClientResult` rather than a thrown
 * error: the HTTP layer maps each variant onto a distinct status code
 * (404 / 400 / 200) without a try/catch. The registry is invalidated on
 * success so the next `getClientRegistry()` rebuilds from the freshly
 * written CSV.
 */
import type { ZodIssue } from 'zod';
import {
  ClientSchema,
  type Client,
  type ClientId,
  type ClientKind,
  type ClientUpdate,
} from '../../../shared/api-contracts.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { getClientsCsvPath, writeClientsCsvFile } from './csv-io.js';
import {
  DEFAULT_CLIENTS_DIR,
  getClientRegistry,
  invalidateClientRegistry,
  type ClientRegistry,
} from './registry.js';

export interface UpdateClientInput {
  readonly clientId: ClientId;
  readonly patch: ClientUpdate;
  /** Override for tests. Defaults to {@link DEFAULT_CLIENTS_DIR}. */
  readonly clientsDir?: string;
  /** Override for tests. Defaults to `todayIsoLocal()`. */
  readonly now?: Date;
}

export type UpdateClientResult =
  | { readonly ok: true; readonly client: Client }
  | { readonly ok: false; readonly code: 'not-found' }
  | {
      readonly ok: false;
      readonly code: 'kind-mismatch';
      readonly existingKind: ClientKind;
      readonly patchKind: ClientKind;
    }
  | {
      readonly ok: false;
      readonly code: 'invalid';
      readonly issues: readonly ZodIssue[];
    };

/**
 * Apply a patch to an existing client row.
 *
 * Flow:
 *   1. Load the current row from the registry. 404 if unknown.
 *   2. Reject kind mismatches explicitly — flipping `direct ↔ agency`
 *      is a separate, destructive operation that breaks every pinned
 *      contract + template override, so this route refuses it outright.
 *   3. Merge the patch onto the existing row, forcing `id` and stamping
 *      `updated_at` server-side so callers can't spoof either.
 *   4. Re-run `ClientSchema` on the merged object. This catches
 *      patch-introduced invariant violations (e.g. an `end_client_*`
 *      value on a direct row) as `invalid` rather than corrupting CSV.
 *   5. Write the whole CSV via `writeClientsCsvFile`, preserving row
 *      order. Invalidate the registry so the next read rebuilds.
 */
export function updateClient(input: UpdateClientInput): UpdateClientResult {
  const clientsDir = input.clientsDir ?? DEFAULT_CLIENTS_DIR;
  const registry = getClientRegistry();

  const existing = registry.indexes.byId.get(input.clientId);
  if (existing === undefined) {
    return { ok: false, code: 'not-found' };
  }

  if (input.patch.kind !== existing.kind) {
    return {
      ok: false,
      code: 'kind-mismatch',
      existingKind: existing.kind,
      patchKind: input.patch.kind,
    };
  }

  const merged = {
    ...existing,
    ...input.patch,
    id: existing.id,
    updated_at: todayIsoLocal(input.now),
  };

  const parsed = ClientSchema.safeParse(merged);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', issues: parsed.error.issues };
  }

  const nextRows = replaceClient(registry, parsed.data);
  writeClientsCsvFile(getClientsCsvPath(clientsDir), nextRows);
  invalidateClientRegistry();

  return { ok: true, client: parsed.data };
}

/** Splice the updated client back into the registry order. */
function replaceClient(
  registry: ClientRegistry,
  updated: Client,
): readonly Client[] {
  return registry.all.map(row => (row.id === updated.id ? updated : row));
}
