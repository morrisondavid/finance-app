/**
 * Obligation registry — the single source of truth for every user-declared
 * recurring financial item (incoming and outgoing). Replaces the four
 * parallel sources that existed historically. See
 * {@link docs/adr/0001-obligations.md} for the decision record.
 *
 * Loading rules:
 *   - `obligations/obligations-seed.csv` — bootstrap rows that used to live
 *     in code constants (FIXED_BILL_OVERRIDES, RENTAL_PROPERTIES,
 *     PAYROLL_ENTRIES). Committed to git.
 *   - `obligations/obligations.csv` — user-editable rows. Any row whose
 *     `id` collides with a seed row takes precedence (user can override
 *     seed amounts without editing git-tracked files).
 */

import path from 'path';
import { fileURLToPath } from 'url';
import {
  type Obligation,
  type IncomingObligation,
  type OutgoingObligation,
  type IncomingObligationCategory,
  type OutgoingObligationCategory,
  type Frequency,
} from '../../../shared/api-contracts.js';
import {
  readObligationsCsvFile,
  getObligationsSeedCsvPath,
  getObligationsUserCsvPath,
  isIncomingObligation,
  isOutgoingObligation,
} from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_OBLIGATIONS_DIR = path.join(__dirname, '../../../obligations');

export interface ObligationRegistry {
  readonly all: readonly Obligation[];
  readonly incoming: readonly IncomingObligation[];
  readonly outgoing: readonly OutgoingObligation[];
  listByCategory<C extends IncomingObligationCategory | OutgoingObligationCategory>(
    category: C,
  ): readonly Extract<Obligation, { category: C }>[];
  listByCadence(frequency: Frequency): readonly Obligation[];
  /**
   * Return the obligation matching this (merchant, account) pair. If
   * `amount` is provided and multiple obligations share the same pair
   * (e.g. two separate insurance policies from the same insurer on the
   * same account), pick the one whose declared amount is closest to
   * `amount`. Without `amount`, returns the first match.
   */
  matchByMerchantAccount(merchant: string, account: string, amount?: number): Obligation | null;
}

/**
 * Merge seed rows and user rows, with user rows taking precedence by `id`.
 * Duplicates within a single file (same id) take the last occurrence —
 * validation still runs against the schema for every row so a duplicate
 * cannot smuggle in a bad shape.
 */
function mergeByIdUserWins(
  seed: readonly Obligation[],
  user: readonly Obligation[],
): Obligation[] {
  const byId = new Map<string, Obligation>();
  for (const row of seed) byId.set(row.id, row);
  for (const row of user) byId.set(row.id, row);
  return [...byId.values()];
}

export function buildObligationRegistry(
  obligationsDir: string = DEFAULT_OBLIGATIONS_DIR,
): ObligationRegistry {
  const seed = readObligationsCsvFile(getObligationsSeedCsvPath(obligationsDir));
  const user = readObligationsCsvFile(getObligationsUserCsvPath(obligationsDir));
  const all = mergeByIdUserWins(seed, user);

  const incoming = all.filter(isIncomingObligation);
  const outgoing = all.filter(isOutgoingObligation);

  return {
    all,
    incoming,
    outgoing,

    listByCategory<C extends IncomingObligationCategory | OutgoingObligationCategory>(
      category: C,
    ): readonly Extract<Obligation, { category: C }>[] {
      return all.filter(
        (c): c is Extract<Obligation, { category: C }> => c.category === category,
      );
    },

    listByCadence(frequency: Frequency): readonly Obligation[] {
      return all.filter(c => c.frequency === frequency);
    },

    matchByMerchantAccount(merchant: string, account: string, amount?: number): Obligation | null {
      const hits = all.filter(c => c.merchant === merchant && c.account !== undefined && c.account === account);
      if (hits.length === 0) return null;
      if (hits.length === 1 || amount === undefined) return hits[0];
      let best = hits[0];
      let bestDiff = Math.abs(amount - best.amount);
      for (let i = 1; i < hits.length; i++) {
        const diff = Math.abs(amount - hits[i].amount);
        if (diff < bestDiff) {
          best = hits[i];
          bestDiff = diff;
        }
      }
      return best;
    },
  };
}

/**
 * Lazily-built default singleton used by the server runtime. Tests can
 * ignore it and call `buildObligationRegistry(dir)` with a fixture
 * directory instead.
 */
let cached: ObligationRegistry | null = null;

export function getObligationRegistry(): ObligationRegistry {
  if (cached === null) cached = buildObligationRegistry();
  return cached;
}

/** Reset the default singleton (tests only). */
export function __resetObligationRegistryForTests(): void {
  cached = null;
}
