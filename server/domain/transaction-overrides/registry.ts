/**
 * In-process cache over `transaction-category-overrides.csv`.
 *
 * The categoriser is called per-transaction on every dashboard
 * render; hitting the disk each time would be wasteful. This
 * registry builds a `Map<hash, CategoryName>` on first access and
 * holds it until either:
 *
 *   - {@link invalidateOverrideRegistry} is called (the POST
 *     classify endpoint does this after writing the CSV so the
 *     next lookup sees the fresh row), or
 *   - {@link __resetOverrideRegistryForTests} is called from tests.
 *
 * Last-write-wins semantics: duplicate hashes in the file are
 * collapsed to the row that appears last, so the caller can append
 * (rather than rewrite) without corrupting lookups.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type { CategoryName } from '../../../shared/category-names.js';
import { getOverridesCsvPath, readOverridesCsvFile } from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_AUTONIZE_IT_DIR = path.join(__dirname, '../../../autonize-it');

export interface OverrideRegistry {
  /** Resolve an override for `hash`, or `null` if none. */
  get(hash: string): CategoryName | null;
  /** Iterate every active override (last-write-wins applied). */
  entries(): ReadonlyMap<string, CategoryName>;
  /** How many distinct hashes currently have overrides. */
  size(): number;
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
  return {
    get(hash: string): CategoryName | null {
      return byHash.get(hash) ?? null;
    },
    entries(): ReadonlyMap<string, CategoryName> {
      return byHash;
    },
    size(): number {
      return byHash.size;
    },
  };
}

/**
 * Lazily-built default singleton. The path is captured on first
 * build and reused on every lazy rebuild, so production code can
 * rely on the process-level `autonize-it/` directory without
 * threading it through every call site.
 */
let cached: OverrideRegistry | null = null;
let cachedDir: string = DEFAULT_AUTONIZE_IT_DIR;

export function getOverrideRegistry(): OverrideRegistry {
  if (cached === null) cached = buildOverrideRegistry(cachedDir);
  return cached;
}

/**
 * Drop the cache so the next call to {@link getOverrideRegistry}
 * rereads the CSV. Called from the POST classify endpoint after an
 * atomic write; also safe to call from hot-reload paths.
 */
export function invalidateOverrideRegistry(): void {
  cached = null;
}

/**
 * Current autonize-it directory the registry is configured to read
 * from. Exposed so writers (e.g. the POST /classify endpoint) can
 * target the same directory the cached registry was built against
 * — in particular so tests that redirect the registry via
 * {@link __resetOverrideRegistryForTests} also redirect writes.
 */
export function getOverridesDir(): string {
  return cachedDir;
}

/** Tests only: reset cache AND the directory used on next build. */
export function __resetOverrideRegistryForTests(
  autonizeItDir: string = DEFAULT_AUTONIZE_IT_DIR,
): void {
  cached = null;
  cachedDir = autonizeItDir;
}
