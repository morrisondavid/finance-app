/**
 * Declared commitments registry.
 *
 * Single source of truth for every user-declared recurring financial item
 * (incoming and outgoing). Replaces the four parallel sources that existed
 * historically — see docs/adr/0001-declared-commitments.md.
 *
 * Loading rules:
 *   - `commitments/seed.csv` carries the bootstrap rows that used to live in
 *     code constants (FIXED_BILL_OVERRIDES, RENTAL_PROPERTIES, PAYROLL_ENTRIES).
 *   - `commitments/commitments.csv` carries user-editable rows. Any row whose
 *     `id` collides with a seed row takes precedence (user can override seed
 *     amounts without editing git-tracked files).
 */

import path from 'path';
import { fileURLToPath } from 'url';
import {
  type DeclaredCommitment,
  type DeclaredIncoming,
  type DeclaredOutgoing,
  type DeclaredIncomingCategory,
  type DeclaredOutgoingCategory,
  type Cadence,
} from '../../../shared/api-contracts.js';
import {
  readCommitmentsCsvFile,
  getCommitmentsSeedCsvPath,
  getCommitmentsUserCsvPath,
  isDeclaredIncoming,
  isDeclaredOutgoing,
} from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_COMMITMENTS_DIR = path.join(__dirname, '../../../commitments');

export interface DeclaredCommitmentRegistry {
  readonly all: readonly DeclaredCommitment[];
  readonly incoming: readonly DeclaredIncoming[];
  readonly outgoing: readonly DeclaredOutgoing[];
  listByCategory<C extends DeclaredIncomingCategory | DeclaredOutgoingCategory>(
    category: C,
  ): readonly Extract<DeclaredCommitment, { category: C }>[];
  listByCadence(cadence: Cadence): readonly DeclaredCommitment[];
  matchByMerchantAccount(merchant: string, account: string): DeclaredCommitment | null;
}

/**
 * Merge seed rows and user rows, with user rows taking precedence by `id`.
 * Duplicates within a single file (same id) take the last occurrence —
 * validation still runs against the schema for every row so a duplicate
 * cannot smuggle in a bad shape.
 */
function mergeByIdUserWins(
  seed: readonly DeclaredCommitment[],
  user: readonly DeclaredCommitment[],
): DeclaredCommitment[] {
  const byId = new Map<string, DeclaredCommitment>();
  for (const row of seed) byId.set(row.id, row);
  for (const row of user) byId.set(row.id, row);
  return [...byId.values()];
}

export function buildDeclaredCommitmentRegistry(
  commitmentsDir: string = DEFAULT_COMMITMENTS_DIR,
): DeclaredCommitmentRegistry {
  const seed = readCommitmentsCsvFile(getCommitmentsSeedCsvPath(commitmentsDir));
  const user = readCommitmentsCsvFile(getCommitmentsUserCsvPath(commitmentsDir));
  const all = mergeByIdUserWins(seed, user);

  const incoming = all.filter(isDeclaredIncoming);
  const outgoing = all.filter(isDeclaredOutgoing);

  return {
    all,
    incoming,
    outgoing,

    listByCategory<C extends DeclaredIncomingCategory | DeclaredOutgoingCategory>(
      category: C,
    ): readonly Extract<DeclaredCommitment, { category: C }>[] {
      return all.filter(
        (c): c is Extract<DeclaredCommitment, { category: C }> => c.category === category,
      );
    },

    listByCadence(cadence: Cadence): readonly DeclaredCommitment[] {
      return all.filter(c => c.cadence === cadence);
    },

    matchByMerchantAccount(merchant: string, account: string): DeclaredCommitment | null {
      return all.find(c => c.merchant === merchant && c.account !== undefined && c.account === account) ?? null;
    },
  };
}

/**
 * Lazily-built default singleton used by the server runtime. Tests can
 * ignore it and call `buildDeclaredCommitmentRegistry(dir)` with a fixture
 * directory instead.
 */
let cached: DeclaredCommitmentRegistry | null = null;

export function getDeclaredCommitmentRegistry(): DeclaredCommitmentRegistry {
  if (cached === null) cached = buildDeclaredCommitmentRegistry();
  return cached;
}

/** Reset the default singleton (tests only). */
export function __resetDeclaredCommitmentRegistryForTests(): void {
  cached = null;
}
