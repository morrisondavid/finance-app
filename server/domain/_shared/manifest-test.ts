/**
 * Manifest assertion helper — the regression lock against "capability
 * drift".
 *
 * Each registry commits a `registry.manifest.test.ts` that lists every
 * index on the registry paired with the file + function that consumes
 * it. This helper enforces the contract:
 *
 *   1. Every index on `registry.indexes` has ≥1 documented consumer.
 *   2. Every documented consumer refers to an index that exists.
 *   3. Every documented consumer file exists on disk.
 *
 * Violations fail loudly with a readable diff. The Entity-dropdown
 * class of bug — a scoping vocabulary / control / index that changes
 * nothing visible — is impossible to ship past this test by construction.
 */

import fs from 'fs';
import path from 'path';

export interface ManifestConsumer {
  /** Repo-relative path (e.g. `server/routes/dashboard.ts`). */
  readonly file: string;
  /**
   * Optional function / call-site hints within the file. Not verified
   * against source — documentation only — but surfaces in errors so
   * reviewers know where to look.
   */
  readonly functions?: readonly string[];
}

export type ManifestConsumersMap = Readonly<Record<string, readonly ManifestConsumer[]>>;

export interface ManifestAssertOpts<TRegistry extends { readonly indexes: object }> {
  readonly registry: TRegistry;
  /** Index key → list of consumers. Every index key on the registry must appear. */
  readonly consumers: ManifestConsumersMap;
  /**
   * Repo root used to resolve `consumer.file` paths. Defaults to
   * `process.cwd()`. Tests normally run from the repo root so the
   * default is fine; override if that stops being true.
   */
  readonly repoRoot?: string;
}

export function assertManifestConsumers<TRegistry extends { readonly indexes: object }>(
  opts: ManifestAssertOpts<TRegistry>,
): void {
  const indexKeys = Object.keys(opts.registry.indexes);
  const documented = Object.keys(opts.consumers);
  const repoRoot = opts.repoRoot ?? process.cwd();

  const orphanedIndexes: string[] = [];
  for (const key of indexKeys) {
    const list = opts.consumers[key];
    if (list === undefined || list.length === 0) {
      orphanedIndexes.push(key);
    }
  }

  const extraConsumers: string[] = [];
  for (const key of documented) {
    if (!indexKeys.includes(key)) extraConsumers.push(key);
  }

  const missingFiles: string[] = [];
  for (const key of documented) {
    const list = opts.consumers[key];
    if (list === undefined) continue;
    for (const c of list) {
      const full = path.join(repoRoot, c.file);
      if (!fs.existsSync(full)) {
        missingFiles.push(`${key} → ${c.file}`);
      }
    }
  }

  const errors: string[] = [];
  if (orphanedIndexes.length > 0) {
    errors.push(
      `Orphaned indexes (no documented consumer): ${orphanedIndexes.join(', ')}. ` +
        `Either delete the index or document its consumer(s) in the manifest test.`,
    );
  }
  if (extraConsumers.length > 0) {
    errors.push(
      `Documented consumers reference index keys that do not exist on the registry: ${extraConsumers.join(', ')}`,
    );
  }
  if (missingFiles.length > 0) {
    errors.push(`Documented consumer files do not exist on disk:\n    ${missingFiles.join('\n    ')}`);
  }
  if (errors.length > 0) {
    throw new Error(`Manifest test failed:\n  - ${errors.join('\n  - ')}`);
  }
}
