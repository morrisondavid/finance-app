/**
 * Clients domain — public query surface.
 *
 * Every function answers one named question by reading a precomputed
 * index on the registry. If you find yourself writing `.filter(...)`
 * over `registry.all`, the answer belongs as a new index in
 * `registry.ts` first, then surfaced here.
 *
 * `resolveTemplatePath` is a pure convention resolver — it does NOT
 * touch the filesystem. The §1.2 Phase B template engine calls this
 * and then reads the resolved path.
 */

import type { Client, ClientId, ClientKind, TemplateKind } from './schema.js';
import {
  getClientRegistry,
  type ClientRegistry,
} from './registry.js';

/** Every configured client, in CSV order. */
export function allClients(
  reg: ClientRegistry = getClientRegistry(),
): readonly Client[] {
  return reg.all;
}

/** Primary-key lookup. Returns null for unknown ids. */
export function findClientById(
  clientId: ClientId,
  reg: ClientRegistry = getClientRegistry(),
): Client | null {
  return reg.indexes.byId.get(clientId) ?? null;
}

/** Every client with a given `kind` (`direct` | `agency`), in CSV order. */
export function listClientsByKind(
  kind: ClientKind,
  reg: ClientRegistry = getClientRegistry(),
): readonly Client[] {
  return reg.indexes.byKind.get(kind) ?? [];
}

/** Every active client (`active === true`). */
export function listActiveClients(
  reg: ClientRegistry = getClientRegistry(),
): readonly Client[] {
  return reg.indexes.active;
}

/**
 * Resolve the on-disk path for a template file by convention.
 *
 * The convention is `clients/templates/{client_id}/{kind}.md`. Every
 * template kind resolves to the same shape regardless of `client.kind`;
 * whether a particular template is meaningful for a direct vs agency
 * client is a routing concern handled in Phase B, not here.
 *
 * This function is pure: no filesystem access, no registry access. The
 * returned path is relative to the repository root. Callers that need
 * to actually read the file prefix an absolute root.
 */
export function resolveTemplatePath(
  clientId: ClientId,
  kind: TemplateKind,
): string {
  return `clients/templates/${clientId}/${kind}.md`;
}
