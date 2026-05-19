/**
 * Single canonical list of durable filesystem paths mirrored to/from S3.
 * Keeps {@link ../data-manifest.ts} digest inputs aligned with durable sync.
 */

/** Top-level directories under repo root whose entire tree is durable state. */
export const DURABLE_TOP_LEVEL_DIRS = [
  'statements',
  'budgets',
  'obligations',
  'debts',
  'deadlines',
  'net-worth',
  'autonize-it',
  'clients',
  'working-days',
  'reserves',
  'invoices',
] as const;

export type DurableTopLevelDir = (typeof DURABLE_TOP_LEVEL_DIRS)[number];

/** CSV paths relative to repo root included in manifest digest (under data/). */
export const DURABLE_DATA_CSV_RELATIVE_PATHS = [
  'data/opening-balances.csv',
  'data/enable-account-links.csv',
  'data/fixed-expense-simulation-exclusions.csv',
] as const;

/**
 * Basenames under `data/` that must never be read from or written to S3.
 * (`enable-sessions.json` is server-local Enable OAuth material.)
 */
export const DATA_SYNC_EXCLUDED_BASENAMES = new Set<string>(['enable-sessions.json']);

/**
 * Digest computation skips these names when walking `data/` (derived artefacts +
 * secrets). Exported so tooling stays aligned with {@link ../data-manifest.ts}.
 */
export const DATA_DIGEST_SKIP_BASENAMES = new Set<string>([
  'manifest.json',
  'transactions.db',
  'enable-sessions.json',
]);
