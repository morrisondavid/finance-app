/**
 * Company domain — public query surface.
 *
 * Every function answers one named question by reading a precomputed
 * index on the registry. If you find yourself writing `.filter(...)`
 * over `registry.all`, the answer belongs as a new index in
 * `registry.ts` first, then surfaced here.
 */

import type { Company, EntityId, Jurisdiction, UkCompany } from './schema.js';
import {
  getCompanyRegistry,
  type CompanyRegistry,
} from './registry.js';

/** Every configured company, in CSV order. */
export function allCompanies(
  reg: CompanyRegistry = getCompanyRegistry(),
): readonly Company[] {
  return reg.all;
}

/** Every entity id, in CSV order. */
export function allEntityIds(
  reg: CompanyRegistry = getCompanyRegistry(),
): readonly EntityId[] {
  return reg.entityIds;
}

/** Primary-key lookup. Returns null for unknown ids. */
export function companyById(
  entityId: EntityId,
  reg: CompanyRegistry = getCompanyRegistry(),
): Company | null {
  return reg.indexes.byId.get(entityId) ?? null;
}

/** Every company in a given jurisdiction (UK, UAE), in CSV order. */
export function companiesByJurisdiction(
  jurisdiction: Jurisdiction,
  reg: CompanyRegistry = getCompanyRegistry(),
): readonly Company[] {
  return reg.indexes.byJurisdiction.get(jurisdiction) ?? [];
}

/** Every active company (`active === true`). */
export function activeCompanies(
  reg: CompanyRegistry = getCompanyRegistry(),
): readonly Company[] {
  return reg.indexes.active;
}

/**
 * First UK limited company in registry order — used by tax auto-seeders
 * that read UK-only columns (`historical_effective_ct_rate`, etc.).
 */
export function ukLtdCompanyOrNull(
  reg: CompanyRegistry = getCompanyRegistry(),
): UkCompany | null {
  for (const c of reg.all) {
    if (c.jurisdiction === 'UK' && c.kind === 'ltd') return c;
  }
  return null;
}
