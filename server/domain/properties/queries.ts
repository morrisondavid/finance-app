/**
 * Properties domain — public query surface.
 *
 * Each function answers a named question via a precomputed index. No
 * `.filter()` over `all` here — if a new answer is needed, add a new
 * index in `registry.ts` first.
 */

import type { Property, PropertyId } from './schema.js';
import { getPropertyRegistry, type PropertyRegistry } from './registry.js';

/** Every configured property, in CSV order. */
export function allProperties(
  reg: PropertyRegistry = getPropertyRegistry(),
): readonly Property[] {
  return reg.all;
}

/** All known property ids, in declaration order. */
export function allPropertyIds(
  reg: PropertyRegistry = getPropertyRegistry(),
): readonly PropertyId[] {
  return reg.allIds;
}

/** Lookup a property by id; returns null when unknown. */
export function propertyById(
  id: PropertyId,
  reg: PropertyRegistry = getPropertyRegistry(),
): Property | null {
  return reg.indexes.byId.get(id) ?? null;
}

/** Validate an unknown string as a `PropertyId` (for cross-registry FK checks). */
export function isPropertyId(
  value: unknown,
  reg: PropertyRegistry = getPropertyRegistry(),
): value is PropertyId {
  return typeof value === 'string' && reg.indexes.byId.has(value as PropertyId);
}
