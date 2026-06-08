/**
 * Deterministic aggregate over durable filesystem inputs (excluding derived DB,
 * manifest output, and Enable session secrets). Used to skip full SQLite rebuild
 * when the tree is unchanged.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from './repo-root.js';
import { writeDurableFileSync } from './storage/durable-fs.js';
import {
  DATA_DIGEST_SKIP_BASENAMES,
  DURABLE_DATA_CSV_RELATIVE_PATHS,
  DURABLE_TOP_LEVEL_DIRS,
} from './storage/durable-paths.js';

export const DATA_MANIFEST_PATH = path.join(REPO_ROOT, 'data', 'manifest.json');

/** Individual files under `data/` (and elsewhere) included in the digest. */
const DURABLE_FILES = DURABLE_DATA_CSV_RELATIVE_PATHS;

function listRelativeFilesUnderDir(dirAbs: string, rootRel: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dirAbs)) return out;
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const ent of entries) {
    const name = ent.name;
    if (name.startsWith('.')) continue;
    const abs = path.join(dirAbs, name);
    const rel = path.join(rootRel, name);
    if (rootRel === 'data' && DATA_DIGEST_SKIP_BASENAMES.has(name)) {
      continue;
    }
    if (ent.isDirectory()) {
      out.push(...listRelativeFilesUnderDir(abs, rel));
    } else if (ent.isFile()) {
      out.push(rel.split(path.sep).join('/'));
    }
  }
  return out;
}

/**
 * Stable SHA-256 over sorted `(path, size, mtimeMs)` lines.
 */
export function computeDataManifestDigest(): string {
  const durableRelativePaths = new Set<string>();
  for (const d of DURABLE_TOP_LEVEL_DIRS) {
    for (const r of listRelativeFilesUnderDir(path.join(REPO_ROOT, d), d)) {
      durableRelativePaths.add(r);
    }
  }
  for (const f of DURABLE_FILES) {
    const abs = path.join(REPO_ROOT, ...f.split('/'));
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      durableRelativePaths.add(f);
    }
  }
  const sorted = [...durableRelativePaths].sort((a, b) => a.localeCompare(b));
  const lines: string[] = [];
  for (const rel of sorted) {
    const abs = path.join(REPO_ROOT, ...rel.split('/'));
    const st = fs.statSync(abs);
    lines.push(`${rel}\t${String(st.size)}\t${String(st.mtimeMs)}`);
  }
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

export interface DataManifestFile {
  readonly digest: string;
  readonly computedAt: string;
}

export function readPersistedManifest(): DataManifestFile | null {
  if (!fs.existsSync(DATA_MANIFEST_PATH)) return null;
  const raw = fs.readFileSync(DATA_MANIFEST_PATH, 'utf-8').trim();
  if (raw === '') return null;
  const parsed: unknown = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('digest' in parsed) ||
    typeof (parsed as { digest: unknown }).digest !== 'string'
  ) {
    return null;
  }
  const digest = (parsed as { digest: string }).digest;
  const computedAt =
    'computedAt' in parsed && typeof (parsed as { computedAt: unknown }).computedAt === 'string'
      ? (parsed as { computedAt: string }).computedAt
      : '';
  return { digest, computedAt };
}

export function persistDataManifest(digest: string): void {
  const payload: DataManifestFile = {
    digest,
    computedAt: new Date().toISOString(),
  };
  writeDurableFileSync(
    DATA_MANIFEST_PATH,
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

/**
 * Recompute from disk and persist (the only way the manifest file may change).
 */
export function recomputeAndPersistDataManifest(): string {
  const digest = computeDataManifestDigest();
  persistDataManifest(digest);
  return digest;
}

export function shouldSkipFullDatabaseRebuild(): boolean {
  const dbPath = path.join(REPO_ROOT, 'data', 'transactions.db');
  if (!fs.existsSync(dbPath)) return false;
  const live = computeDataManifestDigest();
  const persisted = readPersistedManifest();
  if (persisted === null) return false;
  return persisted.digest === live;
}
