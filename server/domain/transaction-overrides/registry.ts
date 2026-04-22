/**
 * Transaction-overrides domain — registry.
 *
 * In-process cache over `transaction-category-overrides.csv`. Each CSV
 * row pins one transaction hash to a specific `CategoryName`,
 * overriding the description-based pattern lookup in
 * {@link categorizeTransaction}. The registry builds a
 * `Map<hash, CategoryName>` on first access and holds it until
 * either:
 *
 *   - {@link invalidateOverrideRegistry} is called (the POST classify
 *     endpoint does this after writing the CSV so the next lookup
 *     sees the fresh row), or
 *   - {@link __resetOverrideRegistryForTests} is called from tests.
 *
 * Last-write-wins semantics: duplicate hashes in the file are
 * collapsed to the row that appears last, so the caller can append
 * (rather than rewrite) without corrupting lookups.
 *
 * Adding a new named question:
 *   1. Add the field to `OverrideRegistry.indexes` below.
 *   2. Populate it in `buildOverrideRegistry` using the `_shared`
 *      index builders.
 *   3. Expose a named query in `queries.ts`.
 *   4. Document the consumer(s) in `registry.manifest.test.ts`.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createRegistry } from '../_shared/create-registry.js';
import type { CategoryName } from './schema.js';
import { getOverridesCsvPath, readOverridesCsvFile } from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_AUTONIZE_IT_DIR = path.join(__dirname, '../../../autonize-it');

export interface OverrideRegistry {
  readonly indexes: {
    /**
     * Last-write-wins lookup from transaction hash → pinned
     * `CategoryName`. The only index this registry maintains; any
     * set-wise question (counts, filter by category) reads from here.
     */
    readonly byHash: ReadonlyMap<string, CategoryName>;
  };
}

export function buildOverrideRegistry(
  autonizeItDir: string = DEFAULT_AUTONIZE_IT_DIR,
): OverrideRegistry {
  const rows = readOverridesCsvFile(getOverridesCsvPath(autonizeItDir)) ?? [];
  const byHash = new Map<string, CategoryName>();
  // File order == chronological. Later rows for the same hash win.
  for (const row of rows) {
    byHash.set(row.hash, row.category);
  }
  return { indexes: { byHash } };
}

/**
 * Directory the default singleton reads from. Closed over by the
 * factory below and mutable via {@link __resetOverrideRegistryForTests}
 * so tests can redirect the registry + writers at a tmp directory in
 * one call.
 */
let defaultDir: string = DEFAULT_AUTONIZE_IT_DIR;

const handle = createRegistry<OverrideRegistry>({
  name: 'transaction-overrides',
  build: () => buildOverrideRegistry(defaultDir),
});

export const getOverrideRegistry = handle.get;
export const invalidateOverrideRegistry = handle.invalidate;

/**
 * Current autonize-it directory the registry is configured to read
 * from. Exposed so writers (e.g. the POST /classify endpoint) can
 * target the same directory the cached registry was built against —
 * in particular so tests that redirect the registry via
 * {@link __resetOverrideRegistryForTests} also redirect writes.
 */
export function getOverridesDir(): string {
  return defaultDir;
}

/** Tests only: reset cache AND the directory used on next build. */
export function __resetOverrideRegistryForTests(
  autonizeItDir: string = DEFAULT_AUTONIZE_IT_DIR,
): void {
  defaultDir = autonizeItDir;
  handle.__resetForTests();
}
