/**
 * Enable Banking session persistence — swappable store with a filesystem
 * default (`data/enable-sessions.json`).
 *
 * Path resolution:
 *   - `ENABLE_BANKING_SESSION_PATH` when set (deployment override).
 *   - Otherwise `data/enable-sessions.json` under the repo root (backed up
 *     with `data/`; gitignored as secrets-adjacent).
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { REPO_ROOT } from '../../repo-root.js';
import { writeDurableFileSync } from '../../storage/durable-fs.js';

export const EnableAccountSessionSchema = z.object({
  sessionId: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  validUntil: z.string().min(1).optional(),
  /** ISO timestamp when bank consent was last completed (OAuth callback). */
  linked_at: z.string().min(1).optional(),
});
export type EnableAccountSession = z.infer<typeof EnableAccountSessionSchema>;

export const EnableSessionsFileSchema = z.record(z.string().min(1), EnableAccountSessionSchema);
export type EnableSessionsFile = z.infer<typeof EnableSessionsFileSchema>;

export interface EnableSessionStore {
  resolvePath(): string;
  readSessions(): EnableSessionsFile;
  writeSessions(sessions: EnableSessionsFile): void;
}

export class FileEnableSessionStore implements EnableSessionStore {
  constructor(private readonly explicitPath?: string) {}

  resolvePath(): string {
    if (this.explicitPath !== undefined && this.explicitPath.trim() !== '') {
      return this.explicitPath;
    }
    const fromEnv = process.env.ENABLE_BANKING_SESSION_PATH?.trim();
    if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
    return path.join(REPO_ROOT, 'data', 'enable-sessions.json');
  }

  readSessions(): EnableSessionsFile {
    const filePath = this.resolvePath();
    if (!fs.existsSync(filePath)) {
      this.migrateFromLegacyRootFile(filePath);
    }
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (raw === '') return {};
    const parsed: unknown = JSON.parse(raw);
    return EnableSessionsFileSchema.parse(parsed);
  }

  /**
   * One-time: if `feed-sessions.local.json` exists at repo root and the
   * canonical path is missing, copy JSON across so operators aren't stranded.
   */
  private migrateFromLegacyRootFile(targetPath: string): void {
    const legacy = path.join(REPO_ROOT, 'feed-sessions.local.json');
    if (!fs.existsSync(legacy)) return;
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    try {
      fs.copyFileSync(legacy, targetPath);
    } catch {
      /* ignore */
    }
  }

  writeSessions(sessions: EnableSessionsFile): void {
    const filePath = this.resolvePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    writeDurableFileSync(filePath, JSON.stringify(sessions, null, 2));
  }
}

let defaultStore: EnableSessionStore = new FileEnableSessionStore();

/** Test hook: replace the process-wide session store. */
export function __setEnableSessionStoreForTests(store: EnableSessionStore): void {
  defaultStore = store;
}

export function __resetEnableSessionStoreForTests(): void {
  defaultStore = new FileEnableSessionStore();
}

export function getEnableSessionStore(): EnableSessionStore {
  return defaultStore;
}

export function resolveSessionPath(): string {
  return getEnableSessionStore().resolvePath();
}

export function readSessions(filePath?: string): EnableSessionsFile {
  if (filePath !== undefined) {
    return new FileEnableSessionStore(filePath).readSessions();
  }
  return getEnableSessionStore().readSessions();
}

export function writeSessions(sessions: EnableSessionsFile, filePath?: string): void {
  if (filePath !== undefined) {
    new FileEnableSessionStore(filePath).writeSessions(sessions);
    return;
  }
  getEnableSessionStore().writeSessions(sessions);
}

export function getAccountSession(
  accountId: string,
  filePath?: string,
): EnableAccountSession | undefined {
  const all = readSessions(filePath);
  return all[accountId];
}

export function setAccountSession(
  accountId: string,
  session: EnableAccountSession,
  filePath?: string,
): void {
  const all = readSessions(filePath);
  all[accountId] = EnableAccountSessionSchema.parse(session);
  writeSessions(all, filePath);
}

export function mergeEnableBankingSessionForAccounts(
  sessionId: string,
  accountUids: readonly string[],
  filePath?: string,
  linkedAt?: string,
): void {
  const id = sessionId.trim();
  if (id === '') throw new Error('sessionId must be non-empty');
  const linkedAtIso = linkedAt?.trim() ?? new Date().toISOString();
  const all = readSessions(filePath);
  for (const uid of accountUids) {
    const u = uid.trim();
    if (u === '') continue;
    const prev = all[u] ?? {};
    all[u] = EnableAccountSessionSchema.parse({
      ...prev,
      sessionId: id,
      linked_at: linkedAtIso,
    });
  }
  writeSessions(all, filePath);
}
