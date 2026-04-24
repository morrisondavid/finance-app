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
 * Resolve the on-disk paths a renderer should try for a given template,
 * in preference order. Returns two candidates:
 *
 * 1. `clients/templates/{client_id}/{kind}.hbs` — per-client override.
 * 2. `clients/templates/{kind}.hbs` — shared default used by every
 *    client when no override is committed.
 *
 * The shared default is the primary file in this shipment (per §1.2.B
 * — DC and La Fosse share the same body; client-specific data flows
 * through `{{client.*}}` context variables). Overrides are supported
 * by the resolver but none are committed yet — we add them only when
 * a genuine tone divergence appears.
 *
 * This function is pure: no filesystem access, no registry access. The
 * returned paths are relative to the repository root. Callers that
 * need to actually read the file prefix an absolute root and pick the
 * first candidate that exists.
 */
export function resolveTemplatePath(
  clientId: ClientId,
  kind: TemplateKind,
): readonly [overridePath: string, sharedPath: string] {
  return [
    `clients/templates/${clientId}/${kind}.hbs`,
    `clients/templates/${kind}.hbs`,
  ] as const;
}
