/**
 * Tiny read/write helper for the gitignored JSON file that holds Enable
 * Banking session / refresh-token state per linked account.
 *
 * Why a file (and not env vars or the SQLite DB)?
 *   - Env vars don't survive token refreshes — Enable's session material
 *     rotates and we need a writable surface.
 *   - SQLite is intentionally ephemeral here (rebuilt from `statements/`),
 *     so persisting tokens there would couple operational state to the
 *     financial data restore story.
 *   - A small JSON file under the project (or `XDG_CONFIG_HOME`) is
 *     trivial to back up out-of-band, easy to hand-edit when debugging,
 *     and obvious to gitignore.
 *
 * Path resolution:
 *   - `ENABLE_BANKING_SESSION_PATH` env var, if set (operator override).
 *   - Otherwise `feed-sessions.local.json` at the project root — this file
 *     is gitignored alongside `feed-credentials.local.json`.
 *
 * The schema is intentionally narrow: per-`accountId` blob + an opaque
 * `validUntil` ISO timestamp. The adapter (`enable-banking.ts`) is the
 * only consumer; both reads and writes go through this module so any
 * shape change lands in one place.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';

/**
 * Per-account session blob. Fields are all optional so a fresh install
 * (no file yet) can be modelled as an empty record without throwing.
 *
 * `sessionId` / `refreshToken` are kept opaque on purpose — the adapter
 * decides what they mean for Enable's specific protocol; the store just
 * round-trips them.
 */
export const EnableAccountSessionSchema = z.object({
  /** Stable Enable session id used as bearer auth for transactions calls. */
  sessionId: z.string().min(1).optional(),
  /** Refresh-style token; used by adapter when `sessionId` expires. */
  refreshToken: z.string().min(1).optional(),
  /** ISO-8601 timestamp marking when `sessionId` is no longer valid. */
  validUntil: z.string().min(1).optional(),
});
export type EnableAccountSession = z.infer<typeof EnableAccountSessionSchema>;

/** File-on-disk shape: map of Enable account UUID → session blob. */
export const EnableSessionsFileSchema = z.record(z.string().min(1), EnableAccountSessionSchema);
export type EnableSessionsFile = z.infer<typeof EnableSessionsFileSchema>;

/**
 * Resolve where the sessions file lives. Honours
 * `ENABLE_BANKING_SESSION_PATH` first (so a deployment can point at a
 * persistent volume / OS secret store wrapper), defaulting to a
 * gitignored file at the project root.
 */
export function resolveSessionPath(): string {
  const fromEnv = process.env.ENABLE_BANKING_SESSION_PATH;
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv;
  return path.resolve(process.cwd(), 'feed-sessions.local.json');
}

/**
 * Read the on-disk sessions file. A missing file or syntactically empty
 * file resolves to `{}` so callers don't have to special-case "first run".
 * Malformed JSON / shape-violating content throws — operators should
 * notice tampering rather than silently lose tokens.
 */
export function readSessions(filePath: string = resolveSessionPath()): EnableSessionsFile {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (raw === '') return {};
  const parsed: unknown = JSON.parse(raw);
  return EnableSessionsFileSchema.parse(parsed);
}

/**
 * Atomically replace the sessions file on disk. Uses a temp file + rename
 * so a crash mid-write can't leave a half-written JSON that the next read
 * would refuse.
 */
export function writeSessions(
  sessions: EnableSessionsFile,
  filePath: string = resolveSessionPath(),
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(sessions, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

/**
 * Convenience: read + return the blob for a single account. Returns
 * `undefined` when no session has been recorded yet (which the adapter
 * treats as "must complete the link flow before we can sync").
 */
export function getAccountSession(
  accountId: string,
  filePath: string = resolveSessionPath(),
): EnableAccountSession | undefined {
  const all = readSessions(filePath);
  return all[accountId];
}

/**
 * Convenience: merge one account's session into the on-disk file. Other
 * accounts' blobs are preserved verbatim.
 */
export function setAccountSession(
  accountId: string,
  session: EnableAccountSession,
  filePath: string = resolveSessionPath(),
): void {
  const all = readSessions(filePath);
  all[accountId] = EnableAccountSessionSchema.parse(session);
  writeSessions(all, filePath);
}

/**
 * Record one Enable `session_id` for every consented account `uid` returned
 * from `POST /sessions` (same session id is stored per uid for this adapter).
 */
export function mergeEnableBankingSessionForAccounts(
  sessionId: string,
  accountUids: readonly string[],
  filePath: string = resolveSessionPath(),
): void {
  const id = sessionId.trim();
  if (id === '') throw new Error('sessionId must be non-empty');
  const all = readSessions(filePath);
  for (const uid of accountUids) {
    const u = uid.trim();
    if (u === '') continue;
    const prev = all[u] ?? {};
    all[u] = EnableAccountSessionSchema.parse({
      ...prev,
      sessionId: id,
    });
  }
  writeSessions(all, filePath);
}
