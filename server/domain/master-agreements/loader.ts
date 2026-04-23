/**
 * Master-agreements loader — intentionally narrower than a full
 * canonical registry.
 *
 * Rationale: the master-agreements CSV is tiny (currently a single
 * row), has exactly two consumers (the contracts registry join, and
 * the eventual Phase B template renderer), and needs no derived
 * indexes. Writing it as a full `createRegistry` registry would cost
 * a manifest test + 5 index-test suites for zero benefit.
 *
 * Instead we expose a thin memoised reader that matches the shape of
 * the other canonical loaders (invalidate + reset-for-tests) without
 * the ceremony. If a future index requirement appears (e.g. byClient),
 * migrating to a full registry is a mechanical change.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type { MasterAgreement } from '../../../shared/api-contracts.js';
import {
  getMasterAgreementsCsvPath,
  readMasterAgreementsCsvFile,
} from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CLIENTS_DIR = path.join(__dirname, '../../../clients');

let cached: readonly MasterAgreement[] | null = null;
let cachedDir: string | null = null;
let explicitOverride: readonly MasterAgreement[] | null = null;

/**
 * Return every configured master agreement, in CSV order. Memoised
 * for the process lifetime. Pass `clientsDir` to override the default
 * read path (used by tests).
 *
 * An `__resetMasterAgreementsForTests(override)` installation takes
 * precedence over disk reads regardless of the `clientsDir` argument —
 * consumer tests can swap in a fixture without spinning up a temp CSV.
 */
export function loadMasterAgreements(
  clientsDir: string = DEFAULT_CLIENTS_DIR,
): readonly MasterAgreement[] {
  if (explicitOverride !== null) return explicitOverride;
  if (cached !== null && cachedDir === clientsDir) return cached;
  const rows = readMasterAgreementsCsvFile(getMasterAgreementsCsvPath(clientsDir));
  cached = rows;
  cachedDir = clientsDir;
  return rows;
}

export function invalidateMasterAgreements(): void {
  cached = null;
  cachedDir = null;
  explicitOverride = null;
}

export function __resetMasterAgreementsForTests(
  override?: readonly MasterAgreement[],
): void {
  if (override === undefined) {
    invalidateMasterAgreements();
    return;
  }
  explicitOverride = override;
  cached = null;
  cachedDir = null;
}
