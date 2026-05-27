/**
 * Shared CSV ingest workflow — the **one** path data takes from "valid CSV
 * file on disk" to "merged + partitioned files in `statements/{account}/csv/`".
 *
 * Both callers funnel through this:
 *   - {@link import('../routes/upload.js') manual upload route} — multer
 *     drops files, then loops calling `ingestCsvFile`.
 *   - {@link import('./feeds/sync.js') runFeedSync} — emits a CSV string
 *     via `parser.emitFeedTransactionsAsCsv`, writes it to a temp file,
 *     then calls `ingestCsvFile`.
 *
 * Per the §3.4 plan: validation, `_originals/` save, normalisation, and
 * `partitionByMonth` live in **one place** so feed and upload behave
 * identically. The DB rebuild (`initDatabase`) is intentionally
 * **excluded** — callers run it once at the end (after a batch upload
 * loop, or after a single feed sync) so the cost isn't paid per file.
 */

import fs from 'fs';
import path from 'path';
import type { AccountName } from '../../shared/api-contracts.js';
import { STATEMENTS_DIR } from '../db/connection.js';
import { REPO_ROOT } from '../repo-root.js';
import { validateAndCleanup } from '../utils/csv-validator.js';
import { normalizeFileOnDisk } from '../utils/filename-normalizer.js';
import { partitionByMonth, type PartitionResult } from '../utils/csv-partitioner.js';

export interface IngestCsvFileOptions {
  /**
   * If true, overwrite any existing original of the same `originalName`
   * in `_originals/`. The manual upload route maps `?overwrite=true` to
   * this; `runFeedSync` maps `force: true` to this.
   */
  readonly overwrite: boolean;
}

export type IngestResult =
  | {
      readonly ok: true;
      readonly outcome: 'ingested';
      /** Absolute path of the file saved into `_originals/`. */
      readonly originalSavedAt: string;
      /** Absolute path of the working CSV after normalisation (may have been deleted by partitioning). */
      readonly finalPath: string;
      /** Filename after `normalizeFileOnDisk` ran (may equal the input name). */
      readonly normalizedFilename: string;
      /** True iff `normalizeFileOnDisk` actually renamed the file. */
      readonly renamed: boolean;
      /** Result from `partitionByMonth` — `deleted: false` means the input was a single-month file kept as-is. */
      readonly partition: PartitionResult;
    }
  | {
      readonly ok: false;
      readonly outcome: 'invalid';
      readonly errors: readonly string[];
    }
  | {
      readonly ok: false;
      readonly outcome: 'duplicate';
      readonly originalName: string;
      readonly existingPath: string;
    };

export type IngestedCsvFileResult = Extract<IngestResult, { ok: true; outcome: 'ingested' }>;

/**
 * Run the full CSV ingest pipeline for one file:
 *   1. `validateAndCleanup(filePath, account, true)` — header check; **deletes
 *      the file on failure** (preserves the existing upload behaviour so
 *      invalid bytes never sit on disk).
 *   2. Duplicate check against `_originals/{originalName}`. Without
 *      `overwrite`, returns `{ outcome: 'duplicate' }` and deletes the
 *      provided `filePath` so callers don't have to clean up.
 *   3. Copy `filePath` to `_originals/{originalName}` (overwriting iff
 *      `overwrite === true`).
 *   4. Move `filePath` into `statements/{account}/csv/{originalName}` if
 *      it isn't already there (e.g. feed sync writes to `os.tmpdir()`).
 *   5. `normalizeFileOnDisk` — rename to `YYYY-MM_transactions_{account}.csv`
 *      when the parser can extract a date, otherwise leave alone.
 *   6. `partitionByMonth` — split multi-month CSVs into per-month files,
 *      merging + row-level deduplicating against any existing monthly file.
 *
 * The function is sync because every step it calls is sync. Returning
 * `IngestResult` keeps the contract narrow: callers don't have to
 * inspect filesystem state to know what happened.
 *
 * `statementsDir` defaults to the project's canonical `statements/`
 * directory (re-exported from `db/connection.ts`). Tests can override it
 * to a temp directory; `runFeedSync` and the upload route use the default.
 */
export function ingestCsvFile(
  account: AccountName,
  filePath: string,
  originalName: string,
  options: IngestCsvFileOptions,
  statementsDir: string = STATEMENTS_DIR,
): IngestResult {
  // Step 1: validate (deletes file on failure)
  const validation = validateAndCleanup(filePath, account, true);
  if (!validation.valid) {
    return {
      ok: false,
      outcome: 'invalid',
      errors: validation.errors ?? ['Unknown validation error'],
    };
  }

  const csvDir = path.join(statementsDir, account, 'csv');
  const originalsDir = path.join(csvDir, '_originals');
  if (!fs.existsSync(originalsDir)) {
    fs.mkdirSync(originalsDir, { recursive: true });
  }

  // Step 2: duplicate check
  const originalDest = path.join(originalsDir, originalName);
  if (fs.existsSync(originalDest) && !options.overwrite) {
    // Caller didn't ask to overwrite — clean up the temp/upload file so we
    // don't leak it; existing original is left untouched.
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Best-effort — caller may already have unlinked, or the path may
      // never have been writable for us. Surface the result either way.
    }
    return {
      ok: false,
      outcome: 'duplicate',
      originalName,
      existingPath: originalDest,
    };
  }

  // Step 3: save original (overwrite-safe — copyFileSync replaces existing)
  fs.copyFileSync(filePath, originalDest);

  // Step 4: ensure the working copy lives in csv/ (multer already does this
  // for uploads; the feed adapter writes to `os.tmpdir()` so we move).
  let workingPath = filePath;
  const csvDest = path.join(csvDir, originalName);
  if (path.dirname(filePath) !== csvDir) {
    fs.copyFileSync(filePath, csvDest);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Same best-effort rationale as the duplicate cleanup above.
    }
    workingPath = csvDest;
  }

  // Step 5: normalise filename to YYYY-MM_transactions_{account}.csv when
  // the parser can extract a statement period from the source filename.
  const normalize = normalizeFileOnDisk(workingPath, account);
  const finalPath = normalize.newPath ?? workingPath;
  const normalizedFilename = normalize.normalized;

  // Step 6: partition (no-op if single-month; multi-month → per-month files)
  const partition = partitionByMonth(finalPath, account);

  return {
    ok: true,
    outcome: 'ingested',
    originalSavedAt: originalDest,
    finalPath,
    normalizedFilename,
    renamed: normalize.renamed,
    partition,
  };
}

function toRepoRelativePosix(absPath: string): string {
  const rel = path.relative(REPO_ROOT, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`[ingestCsvFile] Path outside repo root: ${absPath}`);
  }
  return rel.split(path.sep).join('/');
}

/**
 * Repo-relative POSIX paths to upload after a successful ingest (original under
 * `_originals/`, final monthly CSV(s) under `statements/.../csv/`).
 */
export function durableRelPathsAfterCsvIngest(
  account: AccountName,
  result: IngestedCsvFileResult,
): string[] {
  const out = new Set<string>();
  out.add(toRepoRelativePosix(result.originalSavedAt));
  if (result.partition.deleted) {
    for (const name of result.partition.filesCreated) {
      out.add(`statements/${account}/csv/${name}`);
    }
  } else {
    out.add(toRepoRelativePosix(result.finalPath));
  }
  return [...out];
}
