/**
 * Lazy populated ledger for MCP integration tests.
 *
 * - **Cache hit** (digest unchanged): copy the cached SQLite file (~ms).
 * - **Cache miss**: one worker runs `initDatabase()` under a file lock; others wait.
 *
 * Each vitest worker receives its own DB file so parallel runs never overwrite
 * `data/transactions.db` while another worker has it open.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { REPO_ROOT } from '../../repo-root.js';
import { computeDataManifestDigest } from '../../data-manifest.js';
import { initDatabase, closeDatabase } from '../index.js';

const CACHE_DIR = path.join(REPO_ROOT, 'data', '.vitest-ledger-cache');
const LOCK_PATH = path.join(CACHE_DIR, '.ensure-populated.lock');
const LOCK_WAIT_MS = 300_000;

const ensureByTarget = new Map<string, Promise<void>>();

function removeSqliteSidecars(dbPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`;
    if (fs.existsSync(sidecar)) {
      fs.unlinkSync(sidecar);
    }
  }
}

function copyLedgerSnapshot(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  removeSqliteSidecars(target);
  fs.copyFileSync(source, target);
  removeSqliteSidecars(target);
}

function isHealthySqliteFile(dbPath: string): boolean {
  if (!fs.existsSync(dbPath)) {
    return false;
  }
  removeSqliteSidecars(dbPath);
  try {
    const db = new Database(dbPath, { readonly: true });
    const quickCheck = db.pragma('quick_check', { simple: true });
    db.close();
    return quickCheck === 'ok';
  } catch {
    return false;
  }
}

function deleteSqliteFile(dbPath: string): void {
  removeSqliteSidecars(dbPath);
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

function installLedgerFromCache(cached: string, targetPath: string): boolean {
  if (!isHealthySqliteFile(cached)) {
    deleteSqliteFile(cached);
    return false;
  }
  copyLedgerSnapshot(cached, targetPath);
  return isHealthySqliteFile(targetPath);
}

function isAlreadyExistsError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'EEXIST'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function buildAndCacheLedger(cached: string): Promise<void> {
  const staging = `${cached}.build-staging`;
  deleteSqliteFile(staging);

  const prevDbPath = process.env.BANK_STATEMENTS_DB_PATH;
  const prevSkip = process.env.BANK_STATEMENTS_SKIP_INIT_WHEN_MANIFEST_UNCHANGED;
  process.env.BANK_STATEMENTS_DB_PATH = staging;
  process.env.BANK_STATEMENTS_SKIP_INIT_WHEN_MANIFEST_UNCHANGED = '0';

  console.log('[Test harness] Ledger cache miss — running initDatabase()');
  try {
    await initDatabase();
  } finally {
    closeDatabase();
    if (prevDbPath === undefined) {
      delete process.env.BANK_STATEMENTS_DB_PATH;
    } else {
      process.env.BANK_STATEMENTS_DB_PATH = prevDbPath;
    }
    if (prevSkip === undefined) {
      delete process.env.BANK_STATEMENTS_SKIP_INIT_WHEN_MANIFEST_UNCHANGED;
    } else {
      process.env.BANK_STATEMENTS_SKIP_INIT_WHEN_MANIFEST_UNCHANGED = prevSkip;
    }
  }

  if (!isHealthySqliteFile(staging)) {
    deleteSqliteFile(staging);
    throw new Error('[Test harness] Staging ledger failed integrity check after initDatabase()');
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  copyLedgerSnapshot(staging, cached);
  deleteSqliteFile(staging);
  console.log(`[Test harness] Wrote ledger cache (${path.basename(cached, '.db').slice(0, 12)}…)`);
}

async function ensurePopulatedLedgerInner(targetPath: string): Promise<void> {
  const digest = computeDataManifestDigest();
  const cached = path.join(CACHE_DIR, `${digest}.db`);

  if (installLedgerFromCache(cached, targetPath)) {
    console.log(`[Test harness] Ledger cache hit (${digest.slice(0, 12)}…) → ${path.basename(targetPath)}`);
    return;
  }

  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    if (installLedgerFromCache(cached, targetPath)) {
      console.log(`[Test harness] Ledger cache hit (${digest.slice(0, 12)}…) → ${path.basename(targetPath)}`);
      return;
    }

    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' });
      try {
        if (installLedgerFromCache(cached, targetPath)) {
          console.log(`[Test harness] Ledger cache hit (${digest.slice(0, 12)}…) → ${path.basename(targetPath)}`);
          return;
        }
        await buildAndCacheLedger(cached);
        installLedgerFromCache(cached, targetPath);
        return;
      } finally {
        try {
          fs.unlinkSync(LOCK_PATH);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      if (!isAlreadyExistsError(err)) {
        throw err;
      }
      await sleep(200);
    }
  }

  throw new Error('[Test harness] Timed out waiting for populated ledger');
}

/**
 * Copy or build a populated ledger at `targetPath`. Safe across vitest workers.
 */
export function ensurePopulatedLedgerForVitest(targetPath: string): Promise<void> {
  let pending = ensureByTarget.get(targetPath);
  if (!pending) {
    pending = ensurePopulatedLedgerInner(targetPath);
    ensureByTarget.set(targetPath, pending);
  }
  return pending;
}

export function integrationLedgerDbPath(testModuleUrl: string): string {
  const fileStem = path.basename(fileURLToPath(testModuleUrl), '.ts');
  return path.join(CACHE_DIR, `${fileStem}.db`);
}
