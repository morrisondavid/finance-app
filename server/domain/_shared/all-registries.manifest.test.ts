/**
 * Repo-wide sweep test: every canonical registry under
 * `server/domain/<name>/` must ship a `registry.manifest.test.ts`.
 *
 * A "canonical registry" for this rule is any directory that contains
 * both a `registry.ts` and follows the canonical file layout
 * (`schema.ts`, `queries.ts`, `fixtures.ts`, `index.ts`). Directories
 * not yet migrated to the canonical shape are listed in
 * {@link LEGACY_DOMAINS_EXEMPT} with a tracking note; once a legacy
 * registry migrates, its name is removed from that list and the sweep
 * test automatically starts enforcing the manifest contract for it.
 *
 * Adding a new registry: nothing to do here. The sweep auto-discovers
 * directories matching the canonical shape.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOMAIN_ROOT = path.resolve(__dirname, '..');

/**
 * Directories that live under `server/domain/` but are not set-wise
 * registries (pattern modules, services, derived helpers). Excluded
 * from the sweep.
 */
const NON_REGISTRY_DIRS = new Set<string>([
  '_shared',
  'ai',
  'analytics',
  'deadlines',
  'forecast',
  'income-composition',
  'inter-company',
  'master-agreements',
  'cross-currency',
  'net-worth',
  'payees',
  'outbound',
  'warnings',
  'working-days',
  'templates',
  'expenses',
  'statements',
  'reporting',
]);

/**
 * Directories with a `registry.ts` that have not yet migrated onto
 * the canonical `createRegistry` + canonical test template. Tracked
 * explicitly so the sweep test fails the moment a new registry ships
 * without a manifest, but doesn't force a wholesale migration here.
 *
 * When a registry leaves this list, the sweep test immediately
 * starts asserting its manifest exists.
 */
const LEGACY_DOMAINS_EXEMPT = new Set<string>([
  'obligations',
]);

function isCanonicalRegistryDir(dir: string): boolean {
  const registryFile = path.join(dir, 'registry.ts');
  return fs.existsSync(registryFile);
}

describe('canonical registries sweep', () => {
  it('every canonical registry directory ships registry.manifest.test.ts', () => {
    const entries = fs
      .readdirSync(DOMAIN_ROOT, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(name => !NON_REGISTRY_DIRS.has(name))
      .filter(name => !LEGACY_DOMAINS_EXEMPT.has(name));

    const missing: string[] = [];
    const notARegistry: string[] = [];
    for (const name of entries) {
      const dir = path.join(DOMAIN_ROOT, name);
      if (!isCanonicalRegistryDir(dir)) {
        notARegistry.push(name);
        continue;
      }
      const manifest = path.join(dir, 'registry.manifest.test.ts');
      if (!fs.existsSync(manifest)) {
        missing.push(name);
      }
    }

    if (notARegistry.length > 0) {
      throw new Error(
        `The following server/domain/* directories have no registry.ts — add them to NON_REGISTRY_DIRS or LEGACY_DOMAINS_EXEMPT in this test: ${notARegistry.join(', ')}`,
      );
    }
    expect(missing, `Missing registry.manifest.test.ts for: ${missing.join(', ')}`).toEqual([]);
  });

  it('finds every canonical registry manifest currently in the tree', () => {
    const expected = new Set([
      'accounts',
      'clients',
      'company',
      'contracts',
      'debt-strategy',
      'invoices',
      'leave',
      'merchants',
      'payroll',
      'people',
      'properties',
      'reserves',
      'transaction-overrides',
    ]);
    const found = new Set<string>();
    for (const name of fs.readdirSync(DOMAIN_ROOT)) {
      if (NON_REGISTRY_DIRS.has(name)) continue;
      if (LEGACY_DOMAINS_EXEMPT.has(name)) continue;
      const dir = path.join(DOMAIN_ROOT, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const manifest = path.join(dir, 'registry.manifest.test.ts');
      if (fs.existsSync(manifest)) found.add(name);
    }
    expect(found).toEqual(expected);
  });
});
